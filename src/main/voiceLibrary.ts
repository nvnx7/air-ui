import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { ActionId } from './action'

export interface VoiceCommand {
  id: string
  phrase: string
  action: ActionId
}

// Built-in voice commands seeded on first run.
const PRESETS: Omit<VoiceCommand, 'id'>[] = [
  { phrase: 'take a screenshot', action: 'screenshot' },
  { phrase: 'play music', action: 'play_pause' },
  { phrase: 'pause music', action: 'play_pause' },
  { phrase: 'next track', action: 'next_track' },
  { phrase: 'previous track', action: 'prev_track' },
  { phrase: 'volume up', action: 'volume_up' },
  { phrase: 'volume down', action: 'volume_down' },
  { phrase: 'mute', action: 'mute' },
  { phrase: 'click', action: 'left_click' }
]

let commands: VoiceCommand[] | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'voiceCommands.json')
}

function persist(): void {
  writeFileSync(filePath(), JSON.stringify(commands, null, 2), 'utf8')
}

function ensureLoaded(): void {
  if (commands !== null) return
  const path = filePath()
  if (existsSync(path)) {
    try {
      commands = JSON.parse(readFileSync(path, 'utf8')) as VoiceCommand[]
      return
    } catch (err) {
      console.warn(
        'voiceCommands.json unreadable, reseeding:',
        err instanceof Error ? err.message : err
      )
    }
  }
  commands = PRESETS.map((c) => ({ ...c, id: randomUUID() }))
  persist()
}

export function listVoiceCommands(): VoiceCommand[] {
  ensureLoaded()
  return commands!
}

export function addVoiceCommand(input: Omit<VoiceCommand, 'id'>): VoiceCommand[] {
  ensureLoaded()
  commands!.push({ ...input, id: randomUUID() })
  persist()
  return commands!
}

export function deleteVoiceCommand(id: string): VoiceCommand[] {
  ensureLoaded()
  commands = commands!.filter((c) => c.id !== id)
  persist()
  return commands!
}
