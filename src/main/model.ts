import {
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
  WHISPER_EN_BASE_Q8_0,
  VAD_SILERO_5_1_2,
  loadModel,
  unloadModel,
  type ModelProgressUpdate
} from '@qvac/sdk'

let modelId: string | null = null
let voiceModelId: string | null = null

export function getModelId(): string | null {
  return modelId
}

export function getVoiceModelId(): string | null {
  return voiceModelId
}

export async function loadGestureModel(
  onProgress: (progress: ModelProgressUpdate) => void
): Promise<void> {
  modelId = await loadModel({
    modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
    modelConfig: {
      ctx_size: 2048,
      projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
      gpu_layers: 99,
      device: 'gpu',
      // Default "sequential" tiles the image for encoding; a single modest
      // webcam frame shouldn't need multi-tile encoding at all, and this is
      // the main lever available for the prefill/vision-encode cost that
      // dominates classify-gesture latency (see profiler ttfb ~= total time).
      image_tile_mode: 'disabled'
      // Tried cache-type-k/v: q8_0 KV-cache quantization — no measurable
      // average-latency win and a worse tail (max 608ms vs 465ms), so
      // reverted. Generation is capped at 16 tokens and prefill dominates,
      // leaving little for KV-cache quantization to improve.
    },
    onProgress
  })
}

export async function unloadGestureModel(): Promise<void> {
  if (!modelId) throw new Error('Model not loaded.')
  await unloadModel({ modelId })
  modelId = null
}

// Loaded lazily on first "Enable Voice Commands" rather than eagerly at
// startup like the gesture model — most sessions won't use voice, and a
// second local model held in memory/GPU the whole time isn't free.
export async function loadVoiceModel(): Promise<string> {
  if (voiceModelId) return voiceModelId
  voiceModelId = await loadModel({
    modelSrc: WHISPER_EN_BASE_Q8_0,
    modelConfig: {
      language: 'en',
      // Raw PCM straight off a Web Audio AudioWorklet is Float32 — f32le
      // matches that byte layout exactly, no conversion needed renderer-side.
      audio_format: 'f32le',
      // Required for the streaming "conversation" session (emitVadEvents) to
      // actually detect speech/silence and emit endOfTurn boundaries.
      vadModelSrc: VAD_SILERO_5_1_2,
      // Default min_speech_duration_ms is tuned to reject noise transients
      // and was silently discarding short one-word commands ("click") before
      // they ever reached the decoder — VAD fired but the buffer stayed
      // empty. speech_pad_ms adds a little context on each side so short
      // words aren't clipped right at the phoneme boundary.
      vad_params: { min_speech_duration_ms: 80, speech_pad_ms: 300 },
      contextParams: { use_gpu: true }
    }
  })
  return voiceModelId
}

export async function unloadVoiceModel(): Promise<void> {
  if (!voiceModelId) return
  await unloadModel({ modelId: voiceModelId })
  voiceModelId = null
}
