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
      projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K
    },
    onProgress
  })
}

export async function unloadGestureModel(): Promise<void> {
  if (!modelId) throw new Error('Model not loaded.')
  await unloadModel({ modelId })
  modelId = null
}
