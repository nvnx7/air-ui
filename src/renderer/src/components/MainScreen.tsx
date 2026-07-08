import { useEffect, useRef, useState } from 'react'
import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark
} from '@mediapipe/tasks-vision'
import { OneEuroFilter } from '../oneEuro'
import { startMicCapture, recordFixedDuration, floatToWavBuffer, float32ToBytes } from '../mic'
import SettingsPanel, {
  type TrackerMode,
  type Gesture,
  type ActionInfo,
  type VoiceCommand
} from './SettingsPanel'

// MediaPipe FaceLandmarker topology (478 landmarks incl. refined iris points).
const NOSE_TIP = 1
const RIGHT_IRIS = [469, 470, 471, 472]
const LEFT_IRIS = [474, 475, 476, 477]
const RIGHT_EYE = { outer: 33, inner: 133, upper: 159, lower: 145 }
const LEFT_EYE = { outer: 263, inner: 362, upper: 386, lower: 374 }
// MediaPipe HandLandmarker topology (21 landmarks).
const INDEX_FINGERTIP = 8

// Acceleration curve (velocity-based mode): multiplier grows nonlinearly with
// head speed. ACCEL_BASE keeps slow motion from going fully inert (a head
// tracker has no physical "clutch" the way a lifted mouse does — a soft base
// gain lets returning toward neutral only drag the cursor back a little,
// self-correcting, instead of a hard snap) — but it must stay close to 1 (the
// implicit multiplier of the off-mode formula), otherwise ordinary
// moderate-speed motion ends up *slower* than acceleration-off, requiring
// more head movement instead of less. Starting values — tune by feel.
const ACCEL_BASE = 0.8
const ACCEL_GAIN = 2.2
const ACCEL_EXPONENT = 1.4
const ACCEL_MAX = 8

function average(landmarks: NormalizedLandmark[], indices: number[], axis: 'x' | 'y'): number {
  return indices.reduce((sum, i) => sum + landmarks[i][axis], 0) / indices.length
}

/** Coarse gaze point: iris position relative to each eye's corners/lids, averaged across both eyes. */
function gazePoint(face: NormalizedLandmark[]): { x: number; y: number } {
  const rIrisX = average(face, RIGHT_IRIS, 'x')
  const rIrisY = average(face, RIGHT_IRIS, 'y')
  const lIrisX = average(face, LEFT_IRIS, 'x')
  const lIrisY = average(face, LEFT_IRIS, 'y')

  const rx =
    (rIrisX - face[RIGHT_EYE.inner].x) / (face[RIGHT_EYE.outer].x - face[RIGHT_EYE.inner].x)
  const lx = (lIrisX - face[LEFT_EYE.inner].x) / (face[LEFT_EYE.outer].x - face[LEFT_EYE.inner].x)
  const ry =
    (rIrisY - face[RIGHT_EYE.upper].y) / (face[RIGHT_EYE.lower].y - face[RIGHT_EYE.upper].y)
  const ly = (lIrisY - face[LEFT_EYE.upper].y) / (face[LEFT_EYE.lower].y - face[LEFT_EYE.upper].y)

  return { x: (rx + lx) / 2, y: (ry + ly) / 2 }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

interface Props {
  modelReady: boolean
  modelError: string | null
}

function MainScreen({ modelReady, modelError }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const gestureCanvasRef = useRef<HTMLCanvasElement>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Coarse-source smoothing (head/gaze/finger).
  const fx = useRef(new OneEuroFilter(1.2, 0.01))
  const fy = useRef(new OneEuroFilter(1.2, 0.01))

  // Acceleration (velocity-based) mode state — only meaningful while
  // accelerationEnabledRef is true. cursorShadowRef is our own running
  // estimate of the OS cursor's pixel position, since relative/delta
  // tracking has no fixed formula to derive position from each frame the
  // way absolute tracking does. Nulled to force a fresh seed on trackerMode
  // change, on acceleration toggle, and whenever the coarse source
  // reappears after being lost.
  const prevCoarseNorm = useRef<{ x: number; y: number } | null>(null)
  const prevCoarseTs = useRef(0)
  const cursorShadowRef = useRef<{ x: number; y: number } | null>(null)
  const coarseWasVisible = useRef(false)

  const pointerEnabledRef = useRef(false)
  const sensitivityXRef = useRef(4)
  const sensitivityYRef = useRef(6)
  const centerRef = useRef({ x: 0.5, y: 0.5 })
  const invertXRef = useRef(true)
  const invertYRef = useRef(false)
  const accelerationEnabledRef = useRef(false)
  const trackerModeRef = useRef<TrackerMode>('head')
  const latestPoint = useRef<{ x: number; y: number } | null>(null)
  const dwellRef = useRef(2)
  // Read directly inside the rAF tick loop (defined once in a mount-only
  // effect) — a React state value there would be captured stale forever, the
  // same bug class every other per-frame value already avoids via a ref.
  const screenRef = useRef({ width: 1440, height: 900 })

  const [status, setStatus] = useState('Loading tracker…')
  const [faceSeen, setFaceSeen] = useState(false)
  const [handSeen, setHandSeen] = useState(false)
  const [pointerEnabled, setPointerEnabled] = useState(false)
  const [gesturesEnabled, setGesturesEnabled] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [trackerMode, setTrackerMode] = useState<TrackerMode>('head')
  // Vertical defaults higher than horizontal — observed that equal gain on
  // both axes needed noticeably more head movement vertically than
  // horizontally to cover the same screen distance.
  const [sensitivityX, setSensitivityX] = useState(4)
  const [sensitivityY, setSensitivityY] = useState(6)
  const [invertX, setInvertX] = useState(true)
  const [invertY, setInvertY] = useState(false)
  const [accelerationEnabled, setAccelerationEnabled] = useState(false)
  const [centeredFlash, setCenteredFlash] = useState(false)
  const [detected, setDetected] = useState<string | null>(null)
  const [justFired, setJustFired] = useState<string | null>(null)
  const [gestureProgress, setGestureProgress] = useState(0)
  const [gestureThreshold, setGestureThreshold] = useState(2)
  const [gestureArmed, setGestureArmed] = useState(true)
  const [lastRaw, setLastRaw] = useState<string | null>(null)
  const [dwellFrames, setDwellFrames] = useState(2)
  const [showSettings, setShowSettings] = useState(false)

  const [gestures, setGestures] = useState<Gesture[]>([])
  const [actions, setActions] = useState<ActionInfo[]>([])
  const [voiceCommands, setVoiceCommands] = useState<VoiceCommand[]>([])
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState<string | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'starting' | 'listening' | 'error'>(
    'idle'
  )
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceSampleRate, setVoiceSampleRate] = useState<number | null>(null)

  // Teach form (gesture).
  const [teaching, setTeaching] = useState(false)
  const [teachBusy, setTeachBusy] = useState(false)
  const [teachDescription, setTeachDescription] = useState('')
  const [teachName, setTeachName] = useState('')
  const [teachAction, setTeachAction] = useState('')

  // Teach form (voice command).
  const [teachingVoice, setTeachingVoice] = useState(false)
  const [teachVoiceBusy, setTeachVoiceBusy] = useState(false)
  const [teachVoicePhrase, setTeachVoicePhrase] = useState('')
  const [teachVoiceAction, setTeachVoiceAction] = useState('')
  const [teachVoiceError, setTeachVoiceError] = useState<string | null>(null)

  useEffect(() => {
    pointerEnabledRef.current = pointerEnabled
  }, [pointerEnabled])
  useEffect(() => {
    sensitivityXRef.current = sensitivityX
  }, [sensitivityX])
  useEffect(() => {
    sensitivityYRef.current = sensitivityY
  }, [sensitivityY])
  useEffect(() => {
    invertXRef.current = invertX
  }, [invertX])
  useEffect(() => {
    invertYRef.current = invertY
  }, [invertY])
  useEffect(() => {
    // Toggling (either direction) invalidates any in-flight relative-
    // tracking state — always start the next accelerated frame from a
    // fresh seed rather than resuming from a stale position/timestamp.
    accelerationEnabledRef.current = accelerationEnabled
    prevCoarseNorm.current = null
    cursorShadowRef.current = null
  }, [accelerationEnabled])
  useEffect(() => {
    dwellRef.current = dwellFrames
  }, [dwellFrames])
  useEffect(() => {
    // Switching source changes what "position" even means — reset smoothing
    // and require a fresh Recenter rather than jumping using a stale center.
    trackerModeRef.current = trackerMode
    fx.current.reset()
    fy.current.reset()
    coarseWasVisible.current = false
    prevCoarseNorm.current = null
    cursorShadowRef.current = null
    latestPoint.current = null
    centerRef.current = { x: 0.5, y: 0.5 }
  }, [trackerMode])

  useEffect(() => {
    window.qvacAPI.listActions().then((list) => {
      setActions(list)
      setTeachAction((prev) => prev || list[0]?.id || '')
      setTeachVoiceAction((prev) => prev || list[0]?.id || '')
    })
    window.qvacAPI.listGestures().then(setGestures)
    window.qvacAPI.listVoiceCommands().then(setVoiceCommands)
  }, [])

  // Live voice-command listening — independent of pointer tracking and
  // gesture recognition, gated only by its own "Enable Voice Commands"
  // toggle. Mic capture happens here (renderer owns getUserMedia); the
  // streaming transcription session and phrase matching happen in main.
  useEffect(() => {
    if (!voiceEnabled) {
      setVoiceStatus('idle')
      setVoiceSpeaking(false)
      setVoiceSampleRate(null)
      return
    }
    let cancelled = false
    let stopCapture: (() => void) | null = null
    setVoiceStatus('starting')
    setVoiceError(null)

    async function start(): Promise<void> {
      await window.qvacAPI.startVoiceSession()
      if (cancelled) {
        await window.qvacAPI.stopVoiceSession()
        return
      }
      const capture = await startMicCapture((chunk) => {
        window.qvacAPI.sendVoiceChunk(float32ToBytes(chunk))
      })
      stopCapture = capture.stop
      setVoiceSampleRate(capture.contextSampleRate)
      if (!cancelled) setVoiceStatus('listening')
    }
    start().catch((err) => {
      if (cancelled) return
      console.warn('voice session failed to start:', err)
      setVoiceStatus('error')
      setVoiceError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      stopCapture?.()
      window.qvacAPI.stopVoiceSession()
    }
  }, [voiceEnabled])

  // Load both landmarkers once; branch per-frame on the selected tracker mode
  // so switching Head/Finger/Eyes is instant (no model reload).
  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    async function init(): Promise<void> {
      try {
        screenRef.current = await window.qvacAPI.getScreenSize()
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')

        const [face, hand] = await Promise.all([
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numFaces: 1
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 1
          })
        ])
        if (cancelled) {
          face.close()
          hand.close()
          return
        }
        faceLandmarkerRef.current = face
        handLandmarkerRef.current = hand

        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStatus('Ready')
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    function tick(): void {
      const video = videoRef.current
      if (video && video.readyState >= 2) {
        let ts = performance.now()
        if (ts <= lastTsRef.current) ts = lastTsRef.current + 1
        lastTsRef.current = ts

        tickSingle(video, ts, trackerModeRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    // Absolute-formula head/gaze/finger-solo target: cursor = screenCenter +
    // (pos - calibratedCenter) * sensitivity. Used directly when
    // acceleration is off, and to seed cursorShadowRef when it's on.
    function absoluteTarget(nx: number, ny: number): { x: number; y: number } {
      const { width, height } = screenRef.current
      const gainX = sensitivityXRef.current
      const gainY = sensitivityYRef.current
      const sx = invertXRef.current ? -1 : 1
      const sy = invertYRef.current ? -1 : 1
      const offX = (nx - centerRef.current.x) * sx
      const offY = (ny - centerRef.current.y) * sy
      return {
        x: clamp(width / 2 + offX * gainX * width, 0, width - 1),
        y: clamp(height / 2 + offY * gainY * height, 0, height - 1)
      }
    }

    // Relative/velocity-based target: multiplier grows nonlinearly with how
    // fast the coarse source is moving, so a swift head flick travels much
    // further than the same distance moved slowly (real mouse-acceleration
    // behavior). Seeds from the absolute formula on first use so there's no
    // jump when acceleration is (re)enabled or the source (re)appears.
    function acceleratedTarget(nx: number, ny: number, ts: number): { x: number; y: number } {
      if (!prevCoarseNorm.current || !cursorShadowRef.current) {
        const seeded = absoluteTarget(nx, ny)
        cursorShadowRef.current = seeded
        prevCoarseNorm.current = { x: nx, y: ny }
        prevCoarseTs.current = ts
        return seeded
      }

      const { width, height } = screenRef.current
      const gainX = sensitivityXRef.current
      const gainY = sensitivityYRef.current
      const sx = invertXRef.current ? -1 : 1
      const sy = invertYRef.current ? -1 : 1
      const dx = (nx - prevCoarseNorm.current.x) * sx
      const dy = (ny - prevCoarseNorm.current.y) * sy
      const dt = Math.max((ts - prevCoarseTs.current) / 1000, 1 / 240)
      const speed = Math.hypot(dx, dy) / dt
      const multiplier = clamp(
        ACCEL_BASE + ACCEL_GAIN * Math.pow(speed, ACCEL_EXPONENT),
        ACCEL_BASE,
        ACCEL_MAX
      )

      const target = {
        x: clamp(cursorShadowRef.current.x + dx * gainX * multiplier * width, 0, width - 1),
        y: clamp(cursorShadowRef.current.y + dy * gainY * multiplier * height, 0, height - 1)
      }
      cursorShadowRef.current = target
      prevCoarseNorm.current = { x: nx, y: ny }
      prevCoarseTs.current = ts
      return target
    }

    function tickSingle(video: HTMLVideoElement, ts: number, mode: TrackerMode): void {
      let raw: { x: number; y: number } | null = null

      if (mode === 'finger') {
        const hl = handLandmarkerRef.current
        if (hl) {
          const res = hl.detectForVideo(video, ts)
          const hand = res.landmarks?.[0]
          if (hand?.[INDEX_FINGERTIP])
            raw = { x: hand[INDEX_FINGERTIP].x, y: hand[INDEX_FINGERTIP].y }
        }
        setHandSeen(!!raw)
      } else {
        const fl = faceLandmarkerRef.current
        if (fl) {
          const res = fl.detectForVideo(video, ts)
          const face = res.faceLandmarks?.[0]
          if (face)
            raw = mode === 'gaze' ? gazePoint(face) : { x: face[NOSE_TIP].x, y: face[NOSE_TIP].y }
        }
        setFaceSeen(!!raw)
      }

      if (!raw) {
        coarseWasVisible.current = false
        return
      }
      const nx = fx.current.filter(raw.x, ts)
      const ny = fy.current.filter(raw.y, ts)
      latestPoint.current = { x: nx, y: ny }

      if (!coarseWasVisible.current) {
        // Just (re)appeared — don't compute a delta across the gap since it
        // was last tracked, force a fresh seed instead.
        prevCoarseNorm.current = null
      }
      coarseWasVisible.current = true

      if (pointerEnabledRef.current) {
        const target = accelerationEnabledRef.current
          ? acceleratedTarget(nx, ny, ts)
          : absoluteTarget(nx, ny)
        window.qvacAPI.moveCursor(target.x, target.y)
      }
    }

    init()
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      faceLandmarkerRef.current?.close()
      handLandmarkerRef.current?.close()
      faceLandmarkerRef.current = null
      handLandmarkerRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Downscale the current video frame and persist it for QVAC gesture recognition.
  const captureGestureFrame = async (): Promise<string | null> => {
    const video = videoRef.current
    const canvas = gestureCanvasRef.current
    if (!video || !canvas || video.readyState < 2) return null
    canvas.width = 256
    canvas.height = 192
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return null
    return window.qvacAPI.saveFrame(await blob.arrayBuffer())
  }

  const flashFired = (name: string): void => {
    setJustFired(name)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setJustFired(null), 900)
  }

  // QVAC gesture recognition loop — independent of pointer tracking, gated
  // only by its own "Enable Gestures" toggle.
  useEffect(() => {
    if (!gesturesEnabled || !modelReady) {
      setDetected(null)
      return
    }
    let cancelled = false
    async function loop(): Promise<void> {
      while (!cancelled) {
        try {
          const fp = await captureGestureFrame()
          if (fp) {
            const r = await window.qvacAPI.recognizeGesture(fp, dwellRef.current)
            if (cancelled) break
            setDetected(r.name)
            setGestureProgress(r.progress)
            setGestureThreshold(r.threshold)
            setGestureArmed(r.armed)
            setLastRaw(r.raw)
            if (r.fired && r.name) flashFired(r.name)
          }
        } catch {
          if (cancelled) break
          await new Promise((res) => setTimeout(res, 300))
        }
      }
    }
    loop()
    return () => {
      cancelled = true
    }
  }, [gesturesEnabled, modelReady])

  // Voice session events push from main (a single "start" call yields events
  // over time, unlike the request/response gesture recognition loop) — VAD
  // speaking state for a live "hearing you" indicator, and every finished
  // utterance (matched or not) so silence vs. mishearing are distinguishable.
  useEffect(() => {
    return window.qvacAPI.onVoiceEvent((event) => {
      if (event.type === 'speaking') {
        setVoiceSpeaking(event.speaking)
      } else if (event.type === 'heard') {
        setLastVoiceTranscript(event.transcript)
        if (event.matched && event.phrase) flashFired(event.phrase)
      }
    })
  }, [])

  const recenter = (): void => {
    const point = latestPoint.current
    if (!point) return
    centerRef.current = { x: point.x, y: point.y }
    setCenteredFlash(true)
    setTimeout(() => setCenteredFlash(false), 900)
  }

  const startTeach = async (): Promise<void> => {
    setTeachBusy(true)
    try {
      const framePath = await captureGestureFrame()
      if (!framePath) return
      const description = await window.qvacAPI.describeGesture(framePath)
      setTeachDescription(description)
      setTeachName('')
      setTeachAction(actions[0]?.id ?? '')
      setTeaching(true)
    } finally {
      setTeachBusy(false)
    }
  }

  const saveTeach = async (): Promise<void> => {
    if (!teachName.trim() || !teachDescription.trim() || !teachAction) return
    const updated = await window.qvacAPI.addGesture({
      name: teachName.trim(),
      description: teachDescription.trim(),
      action: teachAction
    })
    setGestures(updated)
    setTeaching(false)
  }

  const removeGesture = async (id: string): Promise<void> => {
    setGestures(await window.qvacAPI.deleteGesture(id))
  }

  const startTeachVoice = async (): Promise<void> => {
    setTeachVoiceBusy(true)
    setTeachVoiceError(null)
    try {
      const { samples, sampleRate } = await recordFixedDuration(3000)
      const wav = floatToWavBuffer(samples, sampleRate)
      const phrase = await window.qvacAPI.transcribeVoiceSample(wav)
      if (!phrase.trim()) {
        setTeachVoiceError("Didn't catch that — try again, closer to the mic.")
        return
      }
      setTeachVoicePhrase(phrase)
      setTeachVoiceAction(actions[0]?.id ?? '')
      setTeachingVoice(true)
    } catch (err) {
      console.warn('teach voice sample failed:', err)
      setTeachVoiceError(err instanceof Error ? err.message : String(err))
    } finally {
      setTeachVoiceBusy(false)
    }
  }

  const saveTeachVoice = async (): Promise<void> => {
    if (!teachVoicePhrase.trim() || !teachVoiceAction) return
    const updated = await window.qvacAPI.addVoiceCommand({
      phrase: teachVoicePhrase.trim(),
      action: teachVoiceAction
    })
    setVoiceCommands(updated)
    setTeachingVoice(false)
  }

  const removeVoiceCommand = async (id: string): Promise<void> => {
    setVoiceCommands(await window.qvacAPI.deleteVoiceCommand(id))
  }

  const showFace = trackerMode === 'head' || trackerMode === 'gaze'
  const showHand = trackerMode === 'finger'
  const recenterDisabled = trackerMode === 'finger' ? !handSeen : !faceSeen

  return (
    <div className="flex flex-col gap-6 p-6 md:flex-row items-start">
      <div className="flex flex-col items-center gap-3 shrink-0">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="rounded-xl w-[480px] -scale-x-100"
        />
        <canvas ref={gestureCanvasRef} className="hidden" />
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span>{status}</span>
          {showFace && (
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  faceSeen ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
              />
              face
            </span>
          )}
          {showHand && (
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  handSeen ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
              />
              hand
            </span>
          )}
        </div>
        <div className="h-10 flex flex-col items-center justify-center gap-1.5">
          {justFired ? (
            <span className="text-2xl font-bold text-emerald-400">✓ {justFired}</span>
          ) : detected ? (
            <>
              <span className="text-2xl font-bold tracking-wide">{detected}</span>
              <div className="flex gap-1.5">
                {Array.from({ length: gestureThreshold }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-2 h-2 rounded-full ${
                      i < gestureProgress ? 'bg-indigo-400' : 'bg-zinc-700'
                    }`}
                  />
                ))}
              </div>
            </>
          ) : gesturesEnabled ? (
            <span className="text-sm text-zinc-600">no gesture</span>
          ) : null}
        </div>
        {gesturesEnabled && !gestureArmed && !justFired && (
          <span className="text-xs text-amber-400">cooling down…</span>
        )}
        {gesturesEnabled && lastRaw && (
          <p className="max-w-[480px] text-center text-xs text-zinc-600">&ldquo;{lastRaw}&rdquo;</p>
        )}
        {voiceEnabled && (
          <div className="flex flex-col items-center gap-1">
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              {voiceStatus === 'starting' && 'starting mic…'}
              {voiceStatus === 'error' && (
                <span className="text-red-400">mic error: {voiceError}</span>
              )}
              {voiceStatus === 'listening' && (
                <>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      voiceSpeaking ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                    }`}
                  />
                  {voiceSpeaking ? 'hearing you…' : 'listening…'}
                  {voiceSampleRate !== null && (
                    <span className={voiceSampleRate === 16000 ? '' : 'text-amber-400'}>
                      ({voiceSampleRate}Hz{voiceSampleRate !== 16000 ? ' — expected 16000' : ''})
                    </span>
                  )}
                </>
              )}
            </span>
            {lastVoiceTranscript && (
              <p className="max-w-[480px] text-center text-xs text-zinc-600">
                heard: &ldquo;{lastVoiceTranscript}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 w-full max-w-[420px]">
        {modelError && <p className="text-red-400 text-sm">Model error: {modelError}</p>}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pointerEnabled}
            onChange={(e) => setPointerEnabled(e.target.checked)}
          />
          <span className={pointerEnabled ? 'text-emerald-400 font-medium' : 'text-zinc-300'}>
            Enable Pointer Tracking
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={gesturesEnabled}
            onChange={(e) => setGesturesEnabled(e.target.checked)}
          />
          <span className={gesturesEnabled ? 'text-emerald-400 font-medium' : 'text-zinc-300'}>
            Enable Gestures
          </span>
        </label>

        {gesturesEnabled && !modelReady && (
          <p className="text-xs text-amber-400">
            Gesture model still loading — actions not active yet.
          </p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.target.checked)}
          />
          <span className={voiceEnabled ? 'text-emerald-400 font-medium' : 'text-zinc-300'}>
            Enable Voice Commands
          </span>
        </label>

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-28">Gesture hold</span>
          <input
            type="range"
            min={2}
            max={5}
            step={1}
            value={dwellFrames}
            onChange={(e) => setDwellFrames(parseInt(e.target.value))}
          />
          <span className="w-16 tabular-nums">{dwellFrames} frames</span>
        </label>

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-28">Horizontal</span>
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={sensitivityX}
            onChange={(e) => setSensitivityX(parseFloat(e.target.value))}
          />
          <span className="w-10 tabular-nums">{sensitivityX.toFixed(1)}</span>
        </label>

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-28">Vertical</span>
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={sensitivityY}
            onChange={(e) => setSensitivityY(parseFloat(e.target.value))}
          />
          <span className="w-10 tabular-nums">{sensitivityY.toFixed(1)}</span>
        </label>

        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={accelerationEnabled}
            onChange={(e) => setAccelerationEnabled(e.target.checked)}
          />
          <span>Enable Acceleration</span>
        </label>

        <button
          onClick={() => setShowSettings(true)}
          className="self-start rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          ⚙ Settings
        </button>

        <p className="text-xs text-zinc-600 leading-relaxed">
          Move your{' '}
          {trackerMode === 'finger' ? 'index finger' : trackerMode === 'gaze' ? 'eyes' : 'head'} to
          steer the cursor. Use taught gestures to act. Open Settings for tracker mode, calibration,
          and the gesture library.
        </p>
      </div>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          trackerMode={trackerMode}
          onTrackerModeChange={setTrackerMode}
          sensitivityX={sensitivityX}
          onSensitivityXChange={setSensitivityX}
          sensitivityY={sensitivityY}
          onSensitivityYChange={setSensitivityY}
          invertX={invertX}
          onInvertXChange={setInvertX}
          invertY={invertY}
          onInvertYChange={setInvertY}
          accelerationEnabled={accelerationEnabled}
          onAccelerationChange={setAccelerationEnabled}
          dwellFrames={dwellFrames}
          onDwellFramesChange={setDwellFrames}
          onRecenter={recenter}
          recenterDisabled={recenterDisabled}
          centeredFlash={centeredFlash}
          gesturesEnabled={gesturesEnabled}
          gestures={gestures}
          actions={actions}
          onDeleteGesture={removeGesture}
          teaching={teaching}
          teachBusy={teachBusy}
          teachDescription={teachDescription}
          onTeachDescriptionChange={setTeachDescription}
          teachName={teachName}
          onTeachNameChange={setTeachName}
          teachAction={teachAction}
          onTeachActionChange={setTeachAction}
          onStartTeach={startTeach}
          onSaveTeach={saveTeach}
          onCancelTeach={() => setTeaching(false)}
          voiceEnabled={voiceEnabled}
          voiceCommands={voiceCommands}
          onDeleteVoiceCommand={removeVoiceCommand}
          teachingVoice={teachingVoice}
          teachVoiceBusy={teachVoiceBusy}
          teachVoiceError={teachVoiceError}
          teachVoicePhrase={teachVoicePhrase}
          onTeachVoicePhraseChange={setTeachVoicePhrase}
          teachVoiceAction={teachVoiceAction}
          onTeachVoiceActionChange={setTeachVoiceAction}
          onStartTeachVoice={startTeachVoice}
          onSaveTeachVoice={saveTeachVoice}
          onCancelTeachVoice={() => setTeachingVoice(false)}
        />
      )}
    </div>
  )
}

export default MainScreen
