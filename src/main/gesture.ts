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
  'This is a webcam image of a person. Describe only the hand gesture, or if no hand is shown, the ' +
  'facial expression or eye state, in one short phrase (for example: \'thumbs up\', \'open palm ' +
  "facing camera', 'peace sign with two fingers', 'closed fist', 'pointing finger', 'both eyes " +
  "closed', 'eyes shut', 'winking one eye', 'mouth open'). Focus on the specific shape or state, not " +
  'the person in general.'

export interface RecognizeResult {
  name: string | null
  raw: string
  progress: number // how many consecutive frames the current candidate has held
  threshold: number // frames required to fire (dwell)
  armed: boolean // false while cooling down after a fire
  fired: boolean // an action fired on this frame
}

// Dwell/cooldown state. An action fires only after a gesture is held for
// `dwellFrames` consecutive frames, and then not again until a short cooldown
// elapses. Time-based (not "wait for a NONE frame") because a relaxed-but-
// still-in-frame hand often still gets force-matched to the nearest known
// gesture rather than cleanly reading as NONE — requiring a literal NONE to
// re-arm meant users had to move their hand fully out of the camera.
let candidate: string | null = null
let candidateCount = 0
let firedAt = 0
const FIRE_COOLDOWN_MS = 800

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
    return { name: null, raw: '', progress: 0, threshold, armed: true, fired: false }
  }

  // List each gesture as "NAME: description" so the model knows what each label
  // means (bare enums without meaning were unreliable in earlier testing), then
  // constrain the output to the exact set of names.
  const catalog = gestures.map((g) => `${g.name}: ${g.description}`).join('\n')
  const prompt =
    'This is a webcam image. Here are known gestures/expressions (hand poses, eye or facial ' +
    'states):\n' +
    catalog +
    `\n\nReply with the name of the one that best matches what is currently shown, or ${NONE} if none match clearly.`

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
      return { name: null, raw: '', progress: 0, threshold, armed: true, fired: false }
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
  const armed = Date.now() - firedAt >= FIRE_COOLDOWN_MS

  if (name === null) {
    // Neutral frame: reset the dwell candidate (cooldown still governs re-fire).
    candidate = null
    candidateCount = 0
    return { name: null, raw: final.contentText, progress: 0, threshold, armed, fired: false }
  }

  // Building a candidate: same gesture increments, a switch restarts the count.
  if (name === candidate) {
    candidateCount += 1
  } else {
    candidate = name
    candidateCount = 1
  }

  // Fire exactly once, only when past cooldown and the pose has been held long
  // enough. Holding past the threshold keeps counting but never re-fires.
  let fired = false
  if (armed && candidateCount === threshold) {
    const gesture = gestures.find((g) => g.name === name)
    if (gesture) {
      runAction(gesture.action)
      fired = true
      firedAt = Date.now()
    }
  }

  return {
    name,
    raw: final.contentText,
    progress: Math.min(candidateCount, threshold),
    threshold,
    armed: fired ? false : armed,
    fired
  }
}
