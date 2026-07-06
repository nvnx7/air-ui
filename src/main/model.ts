import {
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
  loadModel,
  unloadModel,
  type ModelProgressUpdate
} from '@qvac/sdk'

let modelId: string | null = null

export function getModelId(): string | null {
  return modelId
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
