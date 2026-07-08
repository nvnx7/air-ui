import { useEffect, useRef, useState } from 'react'
import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark
} from '@mediapipe/tasks-vision'
import { OneEuroFilter } from '../oneEuro'
import SettingsPanel, {
  type TrackerMode,
  type Gesture,
  type ActionInfo
} from './SettingsPanel'

// MediaPipe FaceLandmarker topology (478 landmarks incl. refined iris points).
const NOSE_TIP = 1
const RIGHT_IRIS = [469, 470, 471, 472]
const LEFT_IRIS = [474, 475, 476, 477]
const RIGHT_EYE = { outer: 33, inner: 133, upper: 159, lower: 145 }
const LEFT_EYE = { outer: 263, inner: 362, upper: 386, lower: 374 }
// MediaPipe HandLandmarker topology (21 landmarks).
const INDEX_FINGERTIP = 8

// Combined mode: finger contributes a small bounded fine-adjustment on top of
// head's coarse target, computed as a self-centering relative nudge (like a
// joystick) rather than a second absolute position.
const FINE_RADIUS_PX = 120
const FINGER_REF_DECAY = 0.02

function average(landmarks: NormalizedLandmark[], indices: number[], axis: 'x' | 'y'): number {
  return indices.reduce((sum, i) => sum + landmarks[i][axis], 0) / indices.length
}

/** Coarse gaze point: iris position relative to each eye's corners/lids, averaged across both eyes. */
function gazePoint(face: NormalizedLandmark[]): { x: number; y: number } {
  const rIrisX = average(face, RIGHT_IRIS, 'x')
  const rIrisY = average(face, RIGHT_IRIS, 'y')
  const lIrisX = average(face, LEFT_IRIS, 'x')
  const lIrisY = average(face, LEFT_IRIS, 'y')

  const rx = (rIrisX - face[RIGHT_EYE.inner].x) / (face[RIGHT_EYE.outer].x - face[RIGHT_EYE.inner].x)
  const lx = (lIrisX - face[LEFT_EYE.inner].x) / (face[LEFT_EYE.outer].x - face[LEFT_EYE.inner].x)
  const ry = (rIrisY - face[RIGHT_EYE.upper].y) / (face[RIGHT_EYE.lower].y - face[RIGHT_EYE.upper].y)
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

  // Coarse-source smoothing (head/gaze/finger-solo, and head's component in combined).
  const fx = useRef(new OneEuroFilter(1.2, 0.01))
  const fy = useRef(new OneEuroFilter(1.2, 0.01))
  // Fine-source smoothing (finger, combined mode only).
  const fineFx = useRef(new OneEuroFilter(1.2, 0.01))
  const fineFy = useRef(new OneEuroFilter(1.2, 0.01))
  // Self-centering reference the fine offset is measured against.
  const fingerRefX = useRef(0.5)
  const fingerRefY = useRef(0.5)
  const fingerWasVisible = useRef(false)

  const pointerEnabledRef = useRef(false)
  const sensitivityRef = useRef(4)
  const fineSensitivityRef = useRef(6)
  const centerRef = useRef({ x: 0.5, y: 0.5 })
  const invertXRef = useRef(true)
  const invertYRef = useRef(false)
  const trackerModeRef = useRef<TrackerMode>('head')
  const latestPoint = useRef<{ x: number; y: number } | null>(null)
  const dwellRef = useRef(2)

  const [status, setStatus] = useState('Loading tracker…')
  const [faceSeen, setFaceSeen] = useState(false)
  const [handSeen, setHandSeen] = useState(false)
  const [pointerEnabled, setPointerEnabled] = useState(false)
  const [gesturesEnabled, setGesturesEnabled] = useState(false)
  const [trackerMode, setTrackerMode] = useState<TrackerMode>('head')
  const [sensitivity, setSensitivity] = useState(4)
  const [fineSensitivity, setFineSensitivity] = useState(6)
  const [invertX, setInvertX] = useState(true)
  const [invertY, setInvertY] = useState(false)
  const [screen, setScreen] = useState({ width: 1440, height: 900 })
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

  // Teach form.
  const [teaching, setTeaching] = useState(false)
  const [teachBusy, setTeachBusy] = useState(false)
  const [teachDescription, setTeachDescription] = useState('')
  const [teachName, setTeachName] = useState('')
  const [teachAction, setTeachAction] = useState('')

  useEffect(() => {
    pointerEnabledRef.current = pointerEnabled
  }, [pointerEnabled])
  useEffect(() => {
    sensitivityRef.current = sensitivity
  }, [sensitivity])
  useEffect(() => {
    fineSensitivityRef.current = fineSensitivity
  }, [fineSensitivity])
  useEffect(() => {
    invertXRef.current = invertX
  }, [invertX])
  useEffect(() => {
    invertYRef.current = invertY
  }, [invertY])
  useEffect(() => {
    dwellRef.current = dwellFrames
  }, [dwellFrames])
  useEffect(() => {
    // Switching source changes what "position" even means — reset smoothing
    // and require a fresh Recenter rather than jumping using a stale center.
    trackerModeRef.current = trackerMode
    fx.current.reset()
    fy.current.reset()
    fineFx.current.reset()
    fineFy.current.reset()
    fingerWasVisible.current = false
    latestPoint.current = null
    centerRef.current = { x: 0.5, y: 0.5 }
  }, [trackerMode])

  useEffect(() => {
    window.qvacAPI.listActions().then((list) => {
      setActions(list)
      setTeachAction((prev) => prev || list[0]?.id || '')
    })
    window.qvacAPI.listGestures().then(setGestures)
  }, [])

  // Load both landmarkers once; branch per-frame on the selected tracker mode
  // so switching Head/Finger/Eyes/Combined is instant (no model reload).
  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    async function init(): Promise<void> {
      try {
        setScreen(await window.qvacAPI.getScreenSize())
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

        const mode = trackerModeRef.current

        if (mode === 'combined') {
          tickCombined(video, ts)
        } else {
          tickSingle(video, ts, mode)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    function tickSingle(video: HTMLVideoElement, ts: number, mode: TrackerMode): void {
      let raw: { x: number; y: number } | null = null

      if (mode === 'finger') {
        const hl = handLandmarkerRef.current
        if (hl) {
          const res = hl.detectForVideo(video, ts)
          const hand = res.landmarks?.[0]
          if (hand?.[INDEX_FINGERTIP]) raw = { x: hand[INDEX_FINGERTIP].x, y: hand[INDEX_FINGERTIP].y }
        }
        setHandSeen(!!raw)
      } else {
        const fl = faceLandmarkerRef.current
        if (fl) {
          const res = fl.detectForVideo(video, ts)
          const face = res.faceLandmarks?.[0]
          if (face) raw = mode === 'gaze' ? gazePoint(face) : { x: face[NOSE_TIP].x, y: face[NOSE_TIP].y }
        }
        setFaceSeen(!!raw)
      }

      if (!raw) return
      const nx = fx.current.filter(raw.x, ts)
      const ny = fy.current.filter(raw.y, ts)
      latestPoint.current = { x: nx, y: ny }

      if (pointerEnabledRef.current) {
        const gain = sensitivityRef.current
        const sx = invertXRef.current ? -1 : 1
        const sy = invertYRef.current ? -1 : 1
        const offX = (nx - centerRef.current.x) * sx
        const offY = (ny - centerRef.current.y) * sy
        const tx = clamp(screen.width / 2 + offX * gain * screen.width, 0, screen.width - 1)
        const ty = clamp(screen.height / 2 + offY * gain * screen.height, 0, screen.height - 1)
        window.qvacAPI.moveCursor(tx, ty)
      }
    }

    function tickCombined(video: HTMLVideoElement, ts: number): void {
      const fl = faceLandmarkerRef.current
      let headRaw: { x: number; y: number } | null = null
      if (fl) {
        const res = fl.detectForVideo(video, ts)
        const face = res.faceLandmarks?.[0]
        if (face) headRaw = { x: face[NOSE_TIP].x, y: face[NOSE_TIP].y }
      }
      setFaceSeen(!!headRaw)

      const hl = handLandmarkerRef.current
      let fingerRaw: { x: number; y: number } | null = null
      if (hl) {
        const res = hl.detectForVideo(video, ts)
        const hand = res.landmarks?.[0]
        if (hand?.[INDEX_FINGERTIP]) fingerRaw = { x: hand[INDEX_FINGERTIP].x, y: hand[INDEX_FINGERTIP].y }
      }
      setHandSeen(!!fingerRaw)

      if (!headRaw) return
      const nx = fx.current.filter(headRaw.x, ts)
      const ny = fy.current.filter(headRaw.y, ts)
      latestPoint.current = { x: nx, y: ny }

      let fineDxPx = 0
      let fineDyPx = 0
      if (fingerRaw) {
        const fnx = fineFx.current.filter(fingerRaw.x, ts)
        const fny = fineFy.current.filter(fingerRaw.y, ts)
        if (!fingerWasVisible.current) {
          // Hand just (re)appeared — snap the reference so it starts at zero
          // offset instead of jumping based on a stale reference.
          fingerRefX.current = fnx
          fingerRefY.current = fny
        }
        fingerWasVisible.current = true

        const rawOffX = fnx - fingerRefX.current
        const rawOffY = fny - fingerRefY.current
        // Leaky integrator: reference drifts toward the current finger
        // position, so holding still lets the fine offset self-recenter —
        // like a joystick nudge, letting you repeat the same nudge direction.
        fingerRefX.current += rawOffX * FINGER_REF_DECAY
        fingerRefY.current += rawOffY * FINGER_REF_DECAY

        const fineGain = fineSensitivityRef.current
        fineDxPx = clamp(rawOffX * fineGain * screen.width, -FINE_RADIUS_PX, FINE_RADIUS_PX)
        fineDyPx = clamp(rawOffY * fineGain * screen.height, -FINE_RADIUS_PX, FINE_RADIUS_PX)
      } else {
        fingerWasVisible.current = false
      }

      if (pointerEnabledRef.current) {
        const gain = sensitivityRef.current
        const sx = invertXRef.current ? -1 : 1
        const sy = invertYRef.current ? -1 : 1
        const offX = (nx - centerRef.current.x) * sx
        const offY = (ny - centerRef.current.y) * sy
        const headTx = clamp(screen.width / 2 + offX * gain * screen.width, 0, screen.width - 1)
        const headTy = clamp(screen.height / 2 + offY * gain * screen.height, 0, screen.height - 1)
        const tx = clamp(headTx + fineDxPx, 0, screen.width - 1)
        const ty = clamp(headTy + fineDyPx, 0, screen.height - 1)
        window.qvacAPI.moveCursor(tx, ty)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const showFace = trackerMode === 'head' || trackerMode === 'gaze' || trackerMode === 'combined'
  const showHand = trackerMode === 'finger' || trackerMode === 'combined'
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
          <p className="text-xs text-amber-400">Gesture model still loading — actions not active yet.</p>
        )}

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
          <span className="w-28">{trackerMode === 'combined' ? 'Head (coarse)' : 'Sensitivity'}</span>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={sensitivity}
            onChange={(e) => setSensitivity(parseFloat(e.target.value))}
          />
          <span className="w-10 tabular-nums">{sensitivity.toFixed(1)}</span>
        </label>

        {trackerMode === 'combined' && (
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="w-28">Finger (fine)</span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={fineSensitivity}
              onChange={(e) => setFineSensitivity(parseFloat(e.target.value))}
            />
            <span className="w-10 tabular-nums">{fineSensitivity.toFixed(1)}</span>
          </label>
        )}

        <button
          onClick={() => setShowSettings(true)}
          className="self-start rounded-xl bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
        >
          ⚙ Settings
        </button>

        <p className="text-xs text-zinc-600 leading-relaxed">
          Move your {trackerMode === 'finger' ? 'index finger' : trackerMode === 'gaze' ? 'eyes' : 'head'}{' '}
          to steer the cursor (Combined mode uses both — see Settings). Use taught gestures to act.
          Open Settings for tracker mode, calibration, and the gesture library.
        </p>
      </div>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          trackerMode={trackerMode}
          onTrackerModeChange={setTrackerMode}
          sensitivity={sensitivity}
          onSensitivityChange={setSensitivity}
          fineSensitivity={fineSensitivity}
          onFineSensitivityChange={setFineSensitivity}
          invertX={invertX}
          onInvertXChange={setInvertX}
          invertY={invertY}
          onInvertYChange={setInvertY}
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
        />
      )}
    </div>
  )
}

export default MainScreen
