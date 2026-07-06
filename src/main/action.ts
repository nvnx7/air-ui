import robot from 'robotjs'

export type Gesture = 'PALM' | 'FIST' | 'UNKNOWN'

/** Maps a classified gesture to a real OS action. No-ops on UNKNOWN. */
export function dispatchAction(gesture: Gesture): void {
  try {
    if (gesture === 'PALM') {
      const pos = robot.getMousePos()
      robot.moveMouse(pos.x + 50, pos.y)
    } else if (gesture === 'FIST') {
      robot.mouseClick()
    }
  } catch (err) {
    console.warn('robotjs action failed:', err instanceof Error ? err.message : err)
  }
}
