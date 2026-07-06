import { completion } from '@qvac/sdk'
import { getModelId } from './model'
import { runAction } from './action'
import { listGestures } from './library'
import { logProfilerSample } from './profiler'

const NONE = 'NONE'

// Raised when the SDK worker aborts an in-flight call during app shutdown.
// Expected on quit/reload (the loop almost always has a call in flight) — benign.
function isShutdownError(err: unknown): boolean {
  const e = err as { code?: number; message?: string }
  return e?.code === 50206 || /shutting down|WORKER_SHUTDOWN/i.test(e?.message ?? '')
}

const DESCRIBE_PROMPT =
  'This is a webcam image of a person. Describe only the hand gesture or pose in one short phrase ' +
  "(for example: 'thumbs up', 'open palm facing camera', 'peace sign with two fingers', " +
  "'closed fist', 'pointing finger'). Focus on the shape of the hand. If no hand is visible, reply 'no hand'."

export interface RecognizeResult {
  name: string | null
  raw: string
  progress: number // how many consecutive frames the current candidate has held
  threshold: number // frames required to fire (dwell)
  armed: boolean // false after a fire until a neutral (NONE) frame re-arms
  fired: boolean // an action fired on this frame
}

// Dwell/arming state. An action fires only after a gesture is held for
// `dwellFrames` consecutive frames, and then not again until the hand returns
// to neutral (a NONE frame re-arms). This makes firing deliberate and forces a
// relax-to-neutral between commands, killing transient mid-motion misfires.
let candidate: string | null = null
let candidateCount = 0
let armed = true

/** Teaching: ask the VLM to describe the hand pose it sees, as a short phrase. */
export async function describeGesture(framePath: string): Promise<string> {
  const modelId = getModelId()
  if (!modelId) throw new Error('Model not loaded.')

  const run = completion({
    modelId,
    history: [{ role: 'user', content: DESCRIBE_PROMPT, attachments: [{ path: framePath }] }],
    stream: false,
    generationParams: { temp: 0, predict: 40 }
  })

  const final = await run.final
  console.log('describe-gesture raw reply:', JSON.stringify(final.contentText))
  return final.contentText.trim()
}

/** Runtime: match the current frame against the taught gesture library. */
export async function recognizeGesture(
  framePath: string,
  dwellFrames: number
): Promise<RecognizeResult> {
  const threshold = Math.max(2, Math.round(dwellFrames))
  const modelId = getModelId()
  if (!modelId) throw new Error('Model not loaded.')

  const gestures = listGestures()
  if (gestures.length === 0) {
    return { name: null, raw: '', progress: 0, threshold, armed, fired: false }
  }

  // List each gesture as "NAME: description" so the model knows what each label
  // means (bare enums without meaning were unreliable in earlier testing), then
  // constrain the output to the exact set of names.
  const catalog = gestures.map((g) => `${g.name}: ${g.description}`).join('\n')
  const prompt =
    'This is a webcam image. Here are known hand gestures:\n' +
    catalog +
    `\n\nReply with the name of the gesture the hand best matches, or ${NONE} if it matches none or no hand is visible.`

  const names = gestures.map((g) => g.name)
  const run = completion({
    modelId,
    history: [{ role: 'user', content: prompt, attachments: [{ path: framePath }] }],
    stream: false,
    generationParams: { temp: 0, predict: 24 },
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'gesture_match',
        schema: {
          type: 'object',
          properties: { match: { type: 'string', enum: [...names, NONE] } },
          required: ['match'],
          additionalProperties: false
        }
      }
    }
  })

  let final: Awaited<typeof run.final>
  try {
    final = await run.final
  } catch (err) {
    if (isShutdownError(err)) {
      return { name: null, raw: '', progress: 0, threshold, armed, fired: false }
    }
    throw err
  }
  console.log('recognize-gesture raw reply:', JSON.stringify(final.contentText))
  logProfilerSample()

  let match = NONE
  try {
    const parsed = JSON.parse(final.contentText) as { match?: string }
    if (parsed.match && (names.includes(parsed.match) || parsed.match === NONE)) match = parsed.match
  } catch {
    // fall through to NONE
  }

  const name = match === NONE ? null : match

  if (name === null) {
    // Neutral frame: reset the dwell candidate and re-arm for the next command.
    candidate = null
    candidateCount = 0
    armed = true
    return { name: null, raw: final.contentText, progress: 0, threshold, armed, fired: false }
  }

  // Building a candidate: same gesture increments, a switch restarts the count.
  if (name === candidate) {
    candidateCount += 1
  } else {
    candidate = name
    candidateCount = 1
  }

  // Fire exactly once, only when armed and the pose has been held long enough.
  // Holding past the threshold keeps counting but never re-fires; firing
  // disarms until a neutral (NONE) frame is seen.
  let fired = false
  if (armed && candidateCount === threshold) {
    const gesture = gestures.find((g) => g.name === name)
    if (gesture) {
      runAction(gesture.action)
      fired = true
      armed = false
    }
  }

  return {
    name,
    raw: final.contentText,
    progress: Math.min(candidateCount, threshold),
    threshold,
    armed,
    fired
  }
}
