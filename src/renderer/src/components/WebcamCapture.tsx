import { useEffect, useRef, useState } from 'react'

interface Gesture {
  id: string
  name: string
  description: string
  action: string
}

interface ActionInfo {
  id: string
  label: string
}

interface Props {
  modelReady: boolean
  modelError: string | null
}

function WebcamCapture({ modelReady, modelError }: Props): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dwellRef = useRef(3)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [debugMode, setDebugMode] = useState(false)

  const [detected, setDetected] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [threshold, setThreshold] = useState(3)
  const [armed, setArmed] = useState(true)
  const [justFired, setJustFired] = useState<string | null>(null)

  const [dwellFrames, setDwellFrames] = useState(3)
  const [gestures, setGestures] = useState<Gesture[]>([])
  const [actions, setActions] = useState<ActionInfo[]>([])

  // Teach form.
  const [teaching, setTeaching] = useState(false)
  const [teachBusy, setTeachBusy] = useState(false)
  const [teachDescription, setTeachDescription] = useState('')
  const [teachName, setTeachName] = useState('')
  const [teachAction, setTeachAction] = useState('')

  useEffect(() => {
    dwellRef.current = dwellFrames
  }, [dwellFrames])

  useEffect(() => {
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: 240, height: 180 } })
      .then((s) => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    window.qvacAPI.listActions().then(setActions)
    window.qvacAPI.listGestures().then(setGestures)
  }, [])

  // Capture the current video frame, persist it to a temp file, return its path.
  const captureFrame = async (): Promise<string | null> => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return null
    const buffer = await blob.arrayBuffer()
    return window.qvacAPI.saveFrame(buffer)
  }

  const flashFired = (name: string): void => {
    setJustFired(name)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setJustFired(null), 900)
  }

  // Recognition loop — runs back-to-back while not paused.
  useEffect(() => {
    if (debugMode || !modelReady || error) return
    let cancelled = false
    async function loop(): Promise<void> {
      while (!cancelled) {
        try {
          const framePath = await captureFrame()
          if (framePath) {
            const r = await window.qvacAPI.recognizeGesture(framePath, dwellRef.current)
            if (cancelled) break
            setDetected(r.name)
            setProgress(r.progress)
            setThreshold(r.threshold)
            setArmed(r.armed)
            if (r.fired && r.name) flashFired(r.name)
          }
        } catch {
          // Transient/shutdown error — keep the loop alive, brief backoff.
          if (cancelled) break
          await new Promise((res) => setTimeout(res, 300))
        }
      }
    }
    loop()
    return () => {
      cancelled = true
    }
  }, [debugMode, modelReady, error])

  const startTeach = async (): Promise<void> => {
    setTeachBusy(true)
    try {
      const framePath = await captureFrame()
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

  const actionLabel = (id: string): string => actions.find((a) => a.id === id)?.label ?? id

  const statusLabel = !modelReady ? 'Loading model…' : debugMode ? 'Paused' : 'Watching'

  return (
    <div className="min-h-screen flex flex-col gap-6 bg-zinc-950 text-zinc-100 p-6">
      <h1 className="text-lg font-semibold">Teachable Gesture Control</h1>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left: camera + live recognition state */}
        <div className="flex flex-col items-center gap-3 shrink-0">
          {error ? (
            <p className="text-red-400 text-sm w-[480px]">Camera error: {error}</p>
          ) : (
            <video ref={videoRef} autoPlay muted playsInline className="rounded-xl w-[480px]" />
          )}
          <canvas ref={canvasRef} className="hidden" />

          {modelError && <p className="text-red-400 text-sm">Model error: {modelError}</p>}

          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                !modelReady
                  ? 'bg-amber-400 animate-pulse'
                  : debugMode
                    ? 'bg-zinc-600'
                    : 'bg-emerald-400'
              }`}
            />
            {statusLabel}
          </div>

          {/* Detected gesture + charge indicator */}
          <div className="h-16 flex flex-col items-center justify-center gap-2">
            {justFired ? (
              <span className="text-3xl font-bold tracking-wide text-emerald-400">
                ✓ {justFired}
              </span>
            ) : detected ? (
              <>
                <span className="text-3xl font-bold tracking-wide">{detected}</span>
                <div className="flex gap-1.5">
                  {Array.from({ length: threshold }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full ${
                        i < progress ? 'bg-indigo-400' : 'bg-zinc-700'
                      }`}
                    />
                  ))}
                </div>
              </>
            ) : (
              <span className="text-sm text-zinc-600">no gesture</span>
            )}
          </div>

          {!armed && !justFired && (
            <span className="text-xs text-amber-400">cooling down…</span>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex flex-col gap-4 w-full max-w-[520px]">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
            />
            Debug mode (pause recognition — required to teach)
          </label>

          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <span className="w-28">Hold to confirm</span>
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

          {/* Teaching (only while paused, so the loop can't fire actions mid-pose). */}
          {debugMode && !teaching && (
            <button
              onClick={startTeach}
              disabled={!!error || !modelReady || teachBusy}
              className="self-start rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {teachBusy ? 'Looking…' : 'Teach a gesture (pose, then click)'}
            </button>
          )}

          {teaching && (
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 p-4">
              <span className="text-xs text-zinc-500">The model saw:</span>
              <textarea
                className="resize-none rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                rows={2}
                value={teachDescription}
                onChange={(e) => setTeachDescription(e.target.value)}
              />
              <input
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                placeholder="Gesture name (e.g. Peace Sign)"
                value={teachName}
                onChange={(e) => setTeachName(e.target.value)}
              />
              <select
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none"
                value={teachAction}
                onChange={(e) => setTeachAction(e.target.value)}
              >
                {actions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={saveTeach}
                  disabled={!teachName.trim()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setTeaching(false)}
                  className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Gesture library. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-zinc-600">Gestures</span>
            {gestures.length === 0 && <span className="text-sm text-zinc-600">None yet.</span>}
            {gestures.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm"
              >
                <span className="font-semibold w-28 truncate">{g.name}</span>
                <span className="flex-1 truncate text-zinc-500" title={g.description}>
                  {g.description}
                </span>
                <span className="text-indigo-400 whitespace-nowrap">{actionLabel(g.action)}</span>
                <button
                  onClick={() => removeGesture(g.id)}
                  className="text-zinc-500 hover:text-red-400"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WebcamCapture
