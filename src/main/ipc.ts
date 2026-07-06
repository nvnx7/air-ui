import { ipcMain } from 'electron'
import { loadGestureModel, unloadGestureModel } from './model'
import { saveFrame } from './frame'
import { describeGesture, recognizeGesture } from './gesture'
import { ACTIONS } from './action'
import { listGestures, addGesture, deleteGesture, type Gesture } from './library'

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

  ipcMain.handle('describe-gesture', async (_event, framePath: string) => {
    return describeGesture(framePath)
  })

  ipcMain.handle('recognize-gesture', async (_event, framePath: string, dwellFrames: number) => {
    return recognizeGesture(framePath, dwellFrames)
  })

  ipcMain.handle('list-actions', async () => ACTIONS)
  ipcMain.handle('list-gestures', async () => listGestures())
  ipcMain.handle('add-gesture', async (_event, input: Omit<Gesture, 'id'>) => addGesture(input))
  ipcMain.handle('delete-gesture', async (_event, id: string) => deleteGesture(id))
}
