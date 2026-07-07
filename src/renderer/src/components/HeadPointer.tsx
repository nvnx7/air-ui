import { useEffect, useRef, useState } from 'react'
import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark
} from '@mediapipe/tasks-vision'
import { OneEuroFilter } from '../oneEuro'

type TrackerMode = 'head' | 'finger' | 'gaze'

// MediaPipe FaceLandmarker topology (478 landmarks incl. refined iris points).
const NOSE_TIP = 1
const RIGHT_IRIS = [469, 470, 471, 472]
const LEFT_IRIS = [474, 475, 476, 477]
const RIGHT_EYE = { outer: 33, inner: 133, upper: 159, lower: 145 }
const LEFT_EYE = { outer: 263, inner: 362, upper: 386, lower: 374 }
// MediaPipe HandLandmarker topology (21 landmarks).
const INDEX_FINGERTIP = 8

// Frames must agree twice before a gesture action fires (snappy but debounced).
const GESTURE_DWELL = 2

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

const MODE_LABEL: Record<TrackerMode, string> = {
  head: 'Head',
  finger: 'Finger',
  gaze: 'Eyes (experimental)'
}

interface Props {
  modelReady: boolean
  modelError: string | null
}

function HeadPointer({ modelReady, modelError }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const gestureCanvasRef = useRef<HTMLCanvasElement>(null)
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)
  const handLandmarkerRef = useRef<HandLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef(0)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fx = useRef(new OneEuroFilter(1.2, 0.01))
  const fy = useRef(new OneEuroFilter(1.2, 0.01))

  const enabledRef = useRef(false)
  const sensitivityRef = useRef(4)
  const centerRef = useRef({ x: 0.5, y: 0.5 })
  const invertXRef = useRef(true)
  const invertYRef = useRef(false)
  const trackerModeRef = useRef<TrackerMode>('head')
  const latestPoint = useRef<{ x: number; y: number } | null>(null)

  const [status, setStatus] = useState('Loading tracker…')
  const [targetSeen, setTargetSeen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [trackerMode, setTrackerMode] = useState<TrackerMode>('head')
  const [sensitivity, setSensitivity] = useState(4)
  const [invertX, setInvertX] = useState(true)
  const [invertY, setInvertY] = useState(false)
  const [screen, setScreen] = useState({ width: 1440, height: 900 })
  const [centeredFlash, setCenteredFlash] = useState(false)
  const [detected, setDetected] = useState<string | null>(null)
  const [justFired, setJustFired] = useState<string | null>(null)
  const [gestureProgress, setGestureProgress] = useState(0)
  const [gestureThreshold, setGestureThreshold] = useState(GESTURE_DWELL)
  const [gestureArmed, setGestureArmed] = useState(true)
  const [lastRaw, setLastRaw] = useState<string | null>(null)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  useEffect(() => {
    sensitivityRef.current = sensitivity
  }, [sensitivity])
  useEffect(() => {
    invertXRef.current = invertX
  }, [invertX])
  useEffect(() => {
    invertYRef.current = invertY
  }, [invertY])
  useEffect(() => {
    // Switching source changes what "position" even means — reset smoothing
    // and require a fresh Recenter rather than jumping using a stale center.
    trackerModeRef.current = trackerMode
    fx.current.reset()
    fy.current.reset()
    latestPoint.current = null
    centerRef.current = { x: 0.5, y: 0.5 }
  }, [trackerMode])

  // Load both landmarkers once; branch per-frame on the selected tracker mode
  // so switching Head/Finger/Eyes is instant (no model reload).
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

        let raw: { x: number; y: number } | null = null
        const mode = trackerModeRef.current

        if (mode === 'finger') {
          const hl = handLandmarkerRef.current
          if (hl) {
            const res = hl.detectForVideo(video, ts)
            const hand = res.landmarks?.[0]
            if (hand?.[INDEX_FINGERTIP]) {
              raw = { x: hand[INDEX_FINGERTIP].x, y: hand[INDEX_FINGERTIP].y }
            }
          }
        } else {
          const fl = faceLandmarkerRef.current
          if (fl) {
            const res = fl.detectForVideo(video, ts)
            const face = res.faceLandmarks?.[0]
            if (face) raw = mode === 'gaze' ? gazePoint(face) : { x: face[NOSE_TIP].x, y: face[NOSE_TIP].y }
          }
        }

        if (raw) {
          setTargetSeen(true)
          const nx = fx.current.filter(raw.x, ts)
          const ny = fy.current.filter(raw.y, ts)
          latestPoint.current = { x: nx, y: ny }

          if (enabledRef.current) {
            const gain = sensitivityRef.current
            const sx = invertXRef.current ? -1 : 1
            const sy = invertYRef.current ? -1 : 1
            const offX = (nx - centerRef.current.x) * sx
            const offY = (ny - centerRef.current.y) * sy
            const tx = clamp(screen.width / 2 + offX * gain * screen.width, 0, screen.width - 1)
            const ty = clamp(screen.height / 2 + offY * gain * screen.height, 0, screen.height - 1)
            window.qvacAPI.moveCursor(tx, ty)
          }
        } else {
          setTargetSeen(false)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
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

  // QVAC gesture recognition loop — actions (fist → click, etc.) fire in main.
  // Runs only while pointer control is enabled, so it can't act while released.
  useEffect(() => {
    if (!enabled || !modelReady) {
      setDetected(null)
      return
    }
    let cancelled = false
    async function loop(): Promise<void> {
      while (!cancelled) {
        try {
          const fp = await captureGestureFrame()
          if (fp) {
            const r = await window.qvacAPI.recognizeGesture(fp, GESTURE_DWELL)
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
  }, [enabled, modelReady])

  const recenter = (): void => {
    const point = latestPoint.current
    if (!point) return
    centerRef.current = { x: point.x, y: point.y }
    setCenteredFlash(true)
    setTimeout(() => setCenteredFlash(false), 900)
  }

  const targetLabel = trackerMode === 'finger' ? 'hand' : 'face'

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
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              targetSeen ? 'bg-emerald-400' : 'bg-zinc-600'
            }`}
          />
          {status} · {targetSeen ? `${targetLabel} tracked` : `no ${targetLabel}`}
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
          ) : enabled ? (
            <span className="text-sm text-zinc-600">no gesture</span>
          ) : null}
        </div>
        {enabled && !gestureArmed && !justFired && (
          <span className="text-xs text-amber-400">cooling down…</span>
        )}
        {enabled && lastRaw && (
          <p className="max-w-[480px] text-center text-xs text-zinc-600">
            &ldquo;{lastRaw}&rdquo;
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 w-full max-w-[520px]">
        {modelError && <p className="text-red-400 text-sm">Model error: {modelError}</p>}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-zinc-600">Tracker</span>
          <div className="flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm w-fit">
            {(Object.keys(MODE_LABEL) as TrackerMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setTrackerMode(m)}
                className={`rounded-md px-3 py-1 ${
                  trackerMode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {trackerMode === 'gaze' && (
            <span className="text-xs text-amber-400">
              Eye tracking is coarse (webcam gaze estimation is inherently imprecise) — expect
              jitter. Increase sensitivity carefully and Recenter often.
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className={enabled ? 'text-emerald-400 font-medium' : 'text-zinc-300'}>
            Enable pointer control {enabled ? '(cursor + gestures live — uncheck to stop)' : ''}
          </span>
        </label>

        {enabled && !modelReady && (
          <p className="text-xs text-amber-400">Gesture model still loading — clicks not active yet.</p>
        )}

        <label className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-28">Sensitivity</span>
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

        <div className="flex gap-4 text-sm text-zinc-400">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={invertX} onChange={(e) => setInvertX(e.target.checked)} />
            Invert X
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={invertY} onChange={(e) => setInvertY(e.target.checked)} />
            Invert Y
          </label>
        </div>

        <button
          onClick={recenter}
          disabled={!targetSeen}
          className="self-start rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {centeredFlash ? '✓ Centered' : 'Recenter (look/point ahead, then click)'}
        </button>

        <p className="text-xs text-zinc-600 leading-relaxed">
          Move your {trackerMode === 'finger' ? 'index finger' : trackerMode === 'gaze' ? 'eyes' : 'head'}{' '}
          to steer the cursor; use your mapped gestures to act (Fist = click by default — edit
          mappings in the Gestures tab). If direction is reversed, toggle Invert X/Y. Switching
          tracker resets calibration — Recenter afterward. Uncheck &ldquo;Enable pointer
          control&rdquo; to instantly release the cursor and stop gestures.
        </p>
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export default HeadPointer
