import { screen } from 'electron'
import robot from 'robotjs'

// Electron's logical-point size, NOT robot.getScreenSize() — the latter
// under-reports on scaled (non-integer backing-scale) displays, which made the
// head-pointer clamp the cursor short of the true right/bottom screen edge.
export function getScreenSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().size
  return { width, height }
}

export function moveCursor(x: number, y: number): void {
  try {
    robot.moveMouse(Math.round(x), Math.round(y))
  } catch (err) {
    console.warn('moveCursor failed:', err instanceof Error ? err.message : err)
  }
}

export function clickMouse(): void {
  try {
    robot.mouseClick()
  } catch (err) {
    console.warn('clickMouse failed:', err instanceof Error ? err.message : err)
  }
}
