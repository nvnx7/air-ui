import { ipcMain } from 'electron'
import { loadGestureModel, unloadGestureModel } from './model'
import { saveFrame } from './frame'
import { classifyGesture } from './gesture'

export function registerIpcHandlers(): void {
  ipcMain.handle('load-model', async () => {
    await loadGestureModel((progress) => console.log(progress))
    return 'model loaded'
  })

  ipcMain.handle('unload-model', async () => {
    await unloadGestureModel()
    return 'model unloaded'
  })

  ipcMain.handle('save-frame', async (_event, buffer: ArrayBuffer) => {
    return saveFrame(buffer)
  })

  ipcMain.handle('classify-gesture', async (_event, framePath: string) => {
    return classifyGesture(framePath)
  })
}
