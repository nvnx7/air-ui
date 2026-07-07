import robot from 'robotjs'

export function getScreenSize(): { width: number; height: number } {
  return robot.getScreenSize()
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
