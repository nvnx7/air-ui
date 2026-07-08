import { transcribe, transcribeStream, type TranscribeStreamConversationSession } from '@qvac/sdk'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadVoiceModel } from './model'
import { runAction, type ActionId } from './action'
import { listVoiceCommands } from './voiceLibrary'
import { isShutdownError } from './gesture'

export type VoiceSessionEvent =
  | { type: 'speaking'; speaking: boolean }
  | { type: 'heard'; transcript: string; matched: boolean; phrase?: string; action?: ActionId }

// Sessions are single-use per the SDK (re-iterating a finished one throws),
// so each "Enable Voice Commands" toggle-on creates a fresh one.
let session: TranscribeStreamConversationSession | null = null
let loggedFirstChunk = false

// Cooldown mirrors gesture.ts's fire debounce — an utterance can straddle
// more than one endOfTurn boundary in edge cases, so guard against a rapid
// double-fire on what a user experiences as a single spoken command.
let firedAt = 0
const FIRE_COOLDOWN_MS = 1200

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Starts live listening. Matches finished utterances against the taught phrase library. */
export async function startVoiceSession(
  onEvent: (event: VoiceSessionEvent) => void
): Promise<void> {
  if (session) return
  const modelId = await loadVoiceModel()
  console.log('[voice] model ready, opening streaming session')
  session = await transcribeStream({ modelId, emitVadEvents: true, endOfTurnSilenceMs: 700 })
  console.log('[voice] session open — listening')
  const active = session
  // Scoped to this session's loop (not module-level) so a rapid stop+start
  // can't let a dying session's trailing events corrupt a new one's buffer.
  let textBuffer = ''

  ;(async () => {
    try {
      for await (const event of active) {
        // Catch-all — logs every event type verbatim (including any we don't
        // branch on below, e.g. "segment") so nothing is invisible while
        // debugging the pipeline.
        console.log('[voice] raw event:', JSON.stringify(event))
        if (event.type === 'text') {
          console.log('[voice] delta:', JSON.stringify(event.text))
          textBuffer += event.text
        } else if (event.type === 'vad') {
          console.log('[voice] vad speaking:', event.speaking, 'p =', event.probability.toFixed(2))
          onEvent({ type: 'speaking', speaking: event.speaking })
        } else if (event.type === 'endOfTurn') {
          console.log('[voice] endOfTurn, buffer so far:', JSON.stringify(textBuffer))
          const utterance = normalize(textBuffer)
          textBuffer = ''
          if (!utterance) continue
          console.log('[voice] heard:', JSON.stringify(utterance))

          const armed = Date.now() - firedAt >= FIRE_COOLDOWN_MS
          // Substring containment (not exact match) so a taught phrase still
          // fires wrapped in natural filler ("hey, take a screenshot please").
          const match = armed
            ? listVoiceCommands().find((c) => utterance.includes(normalize(c.phrase)))
            : undefined

          if (match) {
            runAction(match.action)
            firedAt = Date.now()
            onEvent({
              type: 'heard',
              transcript: utterance,
              matched: true,
              phrase: match.phrase,
              action: match.action
            })
          } else {
            onEvent({ type: 'heard', transcript: utterance, matched: false })
          }
        }
      }
    } catch (err) {
      if (!isShutdownError(err)) {
        console.warn('[voice] session loop ended:', err instanceof Error ? err.message : err)
      }
    }
    console.log('[voice] session loop finished')
  })()
}

/** Feeds a chunk of raw mono 16kHz f32le PCM (from the renderer's AudioWorklet) into the live session. */
export function writeVoiceChunk(chunk: ArrayBuffer): void {
  if (!loggedFirstChunk) {
    loggedFirstChunk = true
    console.log('[voice] first audio chunk received from renderer, bytes:', chunk.byteLength)
  }
  // The underlying RPC stream requires a Buffer/TypedArray, not a bare
  // ArrayBuffer — what actually crosses the IPC boundary from the renderer's
  // ipcRenderer.send(), regardless of what it was typed as at the call site.
  session?.write(Buffer.from(chunk))
}

export function stopVoiceSession(): void {
  session?.end()
  session = null
  loggedFirstChunk = false
}

/** Teaching: transcribes a short recorded WAV sample to seed the editable phrase field. */
export async function transcribeVoiceSample(wavBuffer: ArrayBuffer): Promise<string> {
  const modelId = await loadVoiceModel()
  const samplePath = join(tmpdir(), 'voice-sample.wav')
  await writeFile(samplePath, Buffer.from(wavBuffer))
  console.log('[voice] teach sample saved, bytes:', wavBuffer.byteLength, '-> transcribing')
  const text = await transcribe({ modelId, audioChunk: samplePath })
  console.log('[voice] teach sample transcribed:', JSON.stringify(text.trim()))
  return text.trim()
}
