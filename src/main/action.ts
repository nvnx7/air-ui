import robot from 'robotjs'

export type ActionId =
  | 'play_pause'
  | 'next_track'
  | 'prev_track'
  | 'volume_up'
  | 'volume_down'
  | 'mute'
  | 'left_click'
  | 'screenshot'

export interface ActionInfo {
  id: ActionId
  label: string
}

/** The catalog of actions a gesture can be mapped to (single source of truth). */
export const ACTIONS: ActionInfo[] = [
  { id: 'left_click', label: 'Left Click' },
  { id: 'play_pause', label: 'Play / Pause' },
  { id: 'next_track', label: 'Next Track' },
  { id: 'prev_track', label: 'Previous Track' },
  { id: 'volume_up', label: 'Volume Up' },
  { id: 'volume_down', label: 'Volume Down' },
  { id: 'mute', label: 'Mute' },
  { id: 'screenshot', label: 'Screenshot' }
]

/** Executes a mapped OS action via robotjs. Failures are logged, never thrown. */
export function runAction(action: ActionId): void {
  try {
    switch (action) {
      case 'play_pause':
        robot.keyTap('audio_play')
        break
      case 'next_track':
        robot.keyTap('audio_next')
        break
      case 'prev_track':
        robot.keyTap('audio_prev')
        break
      case 'volume_up':
        robot.keyTap('audio_vol_up')
        break
      case 'volume_down':
        robot.keyTap('audio_vol_down')
        break
      case 'mute':
        robot.keyTap('audio_mute')
        break
      case 'left_click':
        robot.mouseClick()
        break
      case 'screenshot':
        // macOS full-screen screenshot to file.
        robot.keyTap('3', ['command', 'shift'])
        break
    }
  } catch (err) {
    console.warn('runAction failed:', err instanceof Error ? err.message : err)
  }
}
