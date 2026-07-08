// Mono 16kHz raw PCM capture — matches the `f32le` audio_format the voice
// model is loaded with in src/main/model.ts, so no server-side conversion is
// needed. A single shared AudioWorklet-based pipeline backs both live
// streaming (voice command listening) and one-shot recording (teaching).
const SAMPLE_RATE = 16000

let audioContext: AudioContext | null = null
let workletNode: AudioWorkletNode | null = null
let micStream: MediaStream | null = null

function mergeFloat32(chunks: Float32Array[], totalLength: number): Float32Array {
  const merged = new Float32Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

export interface MicCapture {
  stop: () => void
  /** Sample rate the AudioContext actually negotiated — may differ from the requested 16000. */
  contextSampleRate: number
  /** Sample rate the raw mic device/track reported, before any Web Audio resampling. */
  trackSampleRate: number | undefined
}

/**
 * Starts capturing mono mic audio at 16kHz and delivers it in ~200ms raw
 * Float32 PCM batches via onChunk (worklet quanta are only 128 samples —
 * batching avoids calling out hundreds of times a second). Only one capture
 * may be active at a time.
 */
export async function startMicCapture(onChunk: (pcm: Float32Array) => void): Promise<MicCapture> {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: SAMPLE_RATE,
      // Chromium's noise suppression can gate short/soft words down to
      // near-silence before they ever reach the model — off for now while
      // short single-word commands are the main use case.
      echoCancellation: false,
      noiseSuppression: false
    }
  })
  const trackSampleRate = micStream.getAudioTracks()[0]?.getSettings().sampleRate
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
  // AudioContext may silently negotiate a different rate than requested —
  // if this isn't 16000, everything downstream is capturing at the wrong
  // rate even though the byte/sample counts still look internally consistent.
  console.log(
    `[mic] track sampleRate=${trackSampleRate}, AudioContext sampleRate=${audioContext.sampleRate}`
  )
  await audioContext.audioWorklet.addModule('/audio/pcm-worklet.js')

  const source = audioContext.createMediaStreamSource(micStream)
  workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor')

  const BATCH_SAMPLES = Math.round(SAMPLE_RATE * 0.2)
  let batch: Float32Array[] = []
  let batchLength = 0

  workletNode.port.onmessage = (event: MessageEvent<Float32Array>): void => {
    batch.push(event.data)
    batchLength += event.data.length
    if (batchLength >= BATCH_SAMPLES) {
      const merged = mergeFloat32(batch, batchLength)
      batch = []
      batchLength = 0
      onChunk(merged)
    }
  }

  source.connect(workletNode)
  // The graph is pull-driven from the destination — a node with no path to
  // it reliably stops getting process() calls shortly after starting in
  // Chromium (matches the observed symptom: one burst of data, then
  // nothing). The worklet never writes to its output buffer (Web Audio
  // zero-fills it by default), so connecting to destination is silent —
  // no mic feedback/echo — it's purely to keep the graph alive.
  workletNode.connect(audioContext.destination)

  const stop = (): void => {
    workletNode?.port.close()
    workletNode?.disconnect()
    source.disconnect()
    micStream?.getTracks().forEach((t) => t.stop())
    audioContext?.close()
    audioContext = null
    workletNode = null
    micStream = null
  }

  return { stop, contextSampleRate: audioContext.sampleRate, trackSampleRate }
}

/** Records a fixed-duration mono clip, for the teach-a-phrase flow. */
export async function recordFixedDuration(
  ms: number
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const chunks: Float32Array[] = []
  let totalLength = 0
  const { stop, contextSampleRate } = await startMicCapture((chunk) => {
    chunks.push(chunk)
    totalLength += chunk.length
  })
  await new Promise((resolve) => setTimeout(resolve, ms))
  stop()
  return { samples: mergeFloat32(chunks, totalLength), sampleRate: contextSampleRate }
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

/** Packages Float32 samples as a 16-bit-PCM WAV file, for the one-shot transcribe() file path. */
export function floatToWavBuffer(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const bytesPerSample = 2
  const byteRate = sampleRate * bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buffer
}

/** Raw f32le bytes for the live-streaming IPC path (matches the model's audio_format). */
export function float32ToBytes(samples: Float32Array): ArrayBuffer {
  // Float32Array is always backed by a plain ArrayBuffer in this codebase
  // (never SharedArrayBuffer) — TS's DOM lib just widens .buffer's type.
  return samples.buffer.slice(
    samples.byteOffset,
    samples.byteOffset + samples.byteLength
  ) as ArrayBuffer
}
