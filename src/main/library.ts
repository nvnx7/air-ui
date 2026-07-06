import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { ActionId } from './action'

export interface Gesture {
  id: string
  name: string
  description: string
  action: ActionId
}

// Built-in gestures seeded on first run. Descriptions are what the VLM is asked
// to match against, so they read like what the model would "see".
const PRESETS: Omit<Gesture, 'id'>[] = [
  {
    name: 'Open Palm',
    description: 'an open hand facing the camera with all five fingers spread apart',
    action: 'play_pause'
  },
  {
    name: 'Fist',
    description: 'a closed fist with the fingers curled into the palm',
    action: 'mute'
  },
  {
    name: 'Thumbs Up',
    description: 'a hand making a thumbs up, with the thumb pointing up and other fingers curled',
    action: 'volume_up'
  }
]

let gestures: Gesture[] | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'gestures.json')
}

function persist(): void {
  writeFileSync(filePath(), JSON.stringify(gestures, null, 2), 'utf8')
}

function ensureLoaded(): void {
  if (gestures !== null) return
  const path = filePath()
  if (existsSync(path)) {
    try {
      gestures = JSON.parse(readFileSync(path, 'utf8')) as Gesture[]
      return
    } catch (err) {
      console.warn('gestures.json unreadable, reseeding:', err instanceof Error ? err.message : err)
    }
  }
  gestures = PRESETS.map((g) => ({ ...g, id: randomUUID() }))
  persist()
}

export function listGestures(): Gesture[] {
  ensureLoaded()
  return gestures!
}

export function addGesture(input: Omit<Gesture, 'id'>): Gesture[] {
  ensureLoaded()
  gestures!.push({ ...input, id: randomUUID() })
  persist()
  return gestures!
}

export function deleteGesture(id: string): Gesture[] {
  ensureLoaded()
  gestures = gestures!.filter((g) => g.id !== id)
  persist()
  return gestures!
}
