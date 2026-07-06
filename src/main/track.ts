import { completion } from '@qvac/sdk'
import robot from 'robotjs'
import { getModelId } from './model'
import { logProfilerSample } from './profiler'

const TRACK_PROMPT =
  'This is a webcam image. Find the person\'s hand and report the position of its center. ' +
  'x goes from 0 at the left edge to 100 at the right edge; y goes from 0 at the top edge to 100 at the bottom edge. ' +
  'If no hand is visible, set present to false.'

// Tuning knobs (kept here so they are easy to sweep during feasibility testing).
const EMA_ALPHA = 0.6 // higher = more responsive, less smoothing
const DEADZONE = 1.5 // ignore frame-percent deltas below this (kills idle jitter)
const INVERT_X = true // raw selfie frame is mirrored; flip so "hand right -> cursor right"

export interface TrackResult {
  present: boolean
  x: number
  y: number
  raw: string
}

// Last *smoothed* hand position in 0-100 frame space, or null when the hand
// is absent (so re-entry re-seeds the reference without a cursor jump).
let prevX: number | null = null
let prevY: number | null = null

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export async function trackHand(framePath: string, sensitivity: number): Promise<TrackResult> {
  const modelId = getModelId()
  if (!modelId) throw new Error('Model not loaded.')

  const run = completion({
    modelId,
    history: [
      {
        role: 'user',
        content: TRACK_PROMPT,
        attachments: [{ path: framePath }]
      }
    ],
    stream: false,
    generationParams: { temp: 0, predict: 32 },
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'hand_position',
        schema: {
          type: 'object',
          properties: {
            present: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' }
          },
          required: ['present', 'x', 'y'],
          additionalProperties: false
        }
      }
    }
  })

  const final = await run.final
  console.log('track-hand raw reply:', JSON.stringify(final.contentText))
  logProfilerSample()

  let present = false
  let x = 0
  let y = 0
  try {
    const parsed = JSON.parse(final.contentText) as { present?: boolean; x?: number; y?: number }
    present = parsed.present === true && typeof parsed.x === 'number' && typeof parsed.y === 'number'
    if (present) {
      x = clamp(parsed.x as number, 0, 100)
      y = clamp(parsed.y as number, 0, 100)
    }
  } catch {
    // fall through to present=false
  }

  if (!present) {
    // Clutch: drop the reference so the next detection doesn't jump the cursor.
    prevX = null
    prevY = null
    return { present: false, x: 0, y: 0, raw: final.contentText }
  }

  if (prevX === null || prevY === null) {
    // First frame after (re)appearing — seed the reference, don't move yet.
    prevX = x
    prevY = y
    return { present: true, x, y, raw: final.contentText }
  }

  // EMA smoothing on the incoming position to damp per-frame LLM jitter.
  const smoothX = EMA_ALPHA * x + (1 - EMA_ALPHA) * prevX
  const smoothY = EMA_ALPHA * y + (1 - EMA_ALPHA) * prevY

  let deltaX = smoothX - prevX
  let deltaY = smoothY - prevY
  prevX = smoothX
  prevY = smoothY

  // Deadzone kills residual jitter when the hand is held still.
  if (Math.abs(deltaX) < DEADZONE) deltaX = 0
  if (Math.abs(deltaY) < DEADZONE) deltaY = 0

  if (deltaX !== 0 || deltaY !== 0) {
    try {
      const { width, height } = robot.getScreenSize()
      const cur = robot.getMousePos()
      const dxPx = (deltaX / 100) * width * sensitivity * (INVERT_X ? -1 : 1)
      const dyPx = (deltaY / 100) * height * sensitivity
      robot.moveMouse(clamp(cur.x + dxPx, 0, width - 1), clamp(cur.y + dyPx, 0, height - 1))
    } catch (err) {
      console.warn('robotjs move failed:', err instanceof Error ? err.message : err)
    }
  }

  return { present: true, x, y, raw: final.contentText }
}
