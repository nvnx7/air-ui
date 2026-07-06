import { completion } from '@qvac/sdk'
import { getModelId } from './model'
import { dispatchAction, type Gesture } from './action'
import { logProfilerSample } from './profiler'

const GESTURE_PROMPT =
  'Look closely at the image. If a hand is shown as a closed fist, reply with exactly the word FIST. If a hand is shown open with fingers spread apart, like a stop gesture or a high five, reply with exactly the word PALM. If no hand is clearly shown (for example a face or an object), reply with exactly the word NONE.'

export interface GestureResult {
  gesture: Gesture
  raw: string
}

let lastGesture: Gesture | null = null
let consecutiveCount = 0

export async function classifyGesture(framePath: string): Promise<GestureResult> {
  const modelId = getModelId()
  if (!modelId) throw new Error('Model not loaded.')

  const run = completion({
    modelId,
    history: [
      {
        role: 'user',
        content: GESTURE_PROMPT,
        attachments: [{ path: framePath }]
      }
    ],
    stream: false,
    generationParams: { temp: 0, predict: 16 }
  })

  const final = await run.final
  console.log('classify-gesture raw reply:', JSON.stringify(final.contentText))

  const upper = final.contentText.toUpperCase()
  const hasPalm = upper.includes('PALM')
  const hasFist = upper.includes('FIST')
  const hasNone = upper.includes('NONE')
  const gesture: Gesture =
    hasPalm && !hasFist && !hasNone ? 'PALM' : hasFist && !hasPalm && !hasNone ? 'FIST' : 'UNKNOWN'

  if (gesture !== 'UNKNOWN' && gesture === lastGesture) {
    consecutiveCount += 1
  } else {
    lastGesture = gesture
    consecutiveCount = gesture === 'UNKNOWN' ? 0 : 1
  }

  // Debounce: only act the moment a gesture is confirmed twice in a row,
  // not on every subsequent poll while it's still being held.
  if (consecutiveCount === 2) {
    dispatchAction(gesture)
  }

  logProfilerSample()

  return { gesture, raw: final.contentText }
}
