import { useEffect, useRef, useState } from 'react'

function WebcamCapture(): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const processingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [lastFramePath, setLastFramePath] = useState<string | null>(null)
  const [modelReady, setModelReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [gesture, setGesture] = useState<string | null>(null)
  const [rawReply, setRawReply] = useState<string | null>(null)
  const [debugMode, setDebugMode] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({ video: { width: 240, height: 180 } })
      .then((s) => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))

    return () => {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    window.qvacAPI
      .loadModel()
      .then(() => setModelReady(true))
      .catch((err) => setModelError(err instanceof Error ? err.message : String(err)))
  }, [])

  const captureAndClassify = async (): Promise<void> => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (!blob) return

    setCapturedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(blob)
    })

    processingRef.current = true
    setProcessing(true)
    try {
      const buffer = await blob.arrayBuffer()
      const framePath = await window.qvacAPI.saveFrame(buffer)
      setLastFramePath(framePath)

      const result = await window.qvacAPI.classifyGesture(framePath)
      setGesture(result.gesture)
      setRawReply(result.raw)
    } finally {
      processingRef.current = false
      setProcessing(false)
    }
  }

  useEffect(() => {
    if (debugMode || !modelReady || error) return

    let cancelled = false

    async function loop(): Promise<void> {
      while (!cancelled) {
        await captureAndClassify()
      }
    }
    loop()

    return () => {
      cancelled = true
    }
  }, [debugMode, modelReady, error])

  const statusLabel = !modelReady
    ? 'Loading model…'
    : processing
      ? 'Classifying…'
      : debugMode
        ? 'Debug mode — auto-scan paused'
        : 'Scanning…'

  return (
    <div className="h-screen flex flex-col items-center gap-4 bg-zinc-950 text-zinc-100 p-6">
      <h1 className="text-lg font-semibold">Gesture Capture</h1>

      {error ? (
        <p className="text-red-400 text-sm">Camera error: {error}</p>
      ) : (
        <video ref={videoRef} autoPlay muted playsInline className="rounded-xl w-[640px]" />
      )}

      <canvas ref={canvasRef} className="hidden" />

      {modelError && <p className="text-red-400 text-sm">Model error: {modelError}</p>}

      <p className="text-sm text-zinc-500">{statusLabel}</p>

      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          checked={debugMode}
          onChange={(e) => setDebugMode(e.target.checked)}
        />
        Debug mode (manual capture, auto-scan off)
      </label>

      {debugMode && (
        <button
          onClick={captureAndClassify}
          disabled={!!error || !modelReady || processing}
          className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Capture & Classify
        </button>
      )}

      {gesture && <p className="text-3xl font-bold tracking-wide">{gesture}</p>}

      {rawReply && (
        <p className="max-w-md text-center text-xs text-zinc-500">&ldquo;{rawReply}&rdquo;</p>
      )}

      {capturedUrl && (
        <div className="flex flex-col items-center gap-2">
          <span className="text-sm text-zinc-500">Last capture</span>
          <img src={capturedUrl} alt="Captured frame" className="rounded-xl w-[320px]" />
          {lastFramePath && <span className="text-xs text-zinc-600">{lastFramePath}</span>}
        </div>
      )}
    </div>
  )
}

export default WebcamCapture
