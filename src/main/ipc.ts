import { ipcMain } from 'electron'
import { loadGestureModel, unloadGestureModel } from './model'
import { saveFrame } from './frame'
import { describeGesture, recognizeGesture } from './gesture'
import { ACTIONS } from './action'
import { listGestures, addGesture, deleteGesture, type Gesture } from './library'
import { getScreenSize, moveCursor, clickMouse } from './cursor'
import {
  startVoiceSession,
  stopVoiceSession,
  writeVoiceChunk,
  transcribeVoiceSample,
  type VoiceSessionEvent
} from './voice'
import {
  listVoiceCommands,
  addVoiceCommand,
  deleteVoiceCommand,
  type VoiceCommand
} from './voiceLibrary'

export function registerIpcHandlers(): void {
  ipcMain.handle('load-model', async () => {
    await loadGestureModel(() => {})
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

  // Cursor control. move/click are fire-and-forget (send/on) to avoid per-frame
  // promise round-trips at ~60fps; screen-size is a one-time invoke.
  ipcMain.handle('screen-size', async () => getScreenSize())
  ipcMain.on('move-cursor', (_event, x: number, y: number) => moveCursor(x, y))
  ipcMain.on('click-mouse', () => clickMouse())

  // Voice commands. start/stop are one-time invokes; audio chunks stream up
  // fire-and-forget (same reasoning as move-cursor — no promise round-trip
  // per ~100ms chunk); fired commands push back to the renderer via
  // webContents.send since a single `start` call yields events over time.
  ipcMain.handle('start-voice-session', async (event) => {
    await startVoiceSession((voiceEvent: VoiceSessionEvent) => {
      event.sender.send('voice-event', voiceEvent)
    })
    return 'voice session started'
  })
  ipcMain.handle('stop-voice-session', async () => {
    stopVoiceSession()
    return 'voice session stopped'
  })
  ipcMain.on('voice-audio-chunk', (_event, chunk: ArrayBuffer) => writeVoiceChunk(chunk))
  ipcMain.handle('transcribe-voice-sample', async (_event, wavBuffer: ArrayBuffer) =>
    transcribeVoiceSample(wavBuffer)
  )
  ipcMain.handle('list-voice-commands', async () => listVoiceCommands())
  ipcMain.handle('add-voice-command', async (_event, input: Omit<VoiceCommand, 'id'>) =>
    addVoiceCommand(input)
  )
  ipcMain.handle('delete-voice-command', async (_event, id: string) => deleteVoiceCommand(id))
}
