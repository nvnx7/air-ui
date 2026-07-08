// import { contextBridge } from 'electron'
// import { electronAPI } from '@electron-toolkit/preload'

// // Custom APIs for renderer
// const api = {}

// // Use `contextBridge` APIs to expose Electron APIs to
// // renderer only if context isolation is enabled, otherwise
// // just add to the DOM global.
// if (process.contextIsolated) {
//   try {
//     contextBridge.exposeInMainWorld('electron', electronAPI)
//     contextBridge.exposeInMainWorld('api', api)
//   } catch (error) {
//     console.error(error)
//   }
// } else {
//   // @ts-expect-error (define in dts)
//   window.electron = electronAPI
//   // @ts-expect-error (define in dts)
//   window.api = api
// }

import { contextBridge, ipcRenderer } from 'electron'

interface Gesture {
  id: string
  name: string
  description: string
  action: string
}

interface VoiceCommand {
  id: string
  phrase: string
  action: string
}

type VoiceSessionEvent =
  | { type: 'speaking'; speaking: boolean }
  | { type: 'heard'; transcript: string; matched: boolean; phrase?: string; action?: string }

contextBridge.exposeInMainWorld('qvacAPI', {
  loadModel: (): Promise<string> => ipcRenderer.invoke('load-model'),
  unloadModel: (): Promise<string> => ipcRenderer.invoke('unload-model'),
  saveFrame: (buffer: ArrayBuffer): Promise<string> => ipcRenderer.invoke('save-frame', buffer),
  describeGesture: (framePath: string): Promise<string> =>
    ipcRenderer.invoke('describe-gesture', framePath),
  recognizeGesture: (
    framePath: string,
    dwellFrames: number
  ): Promise<{
    name: string | null
    raw: string
    progress: number
    threshold: number
    armed: boolean
    fired: boolean
  }> => ipcRenderer.invoke('recognize-gesture', framePath, dwellFrames),
  listActions: (): Promise<{ id: string; label: string }[]> => ipcRenderer.invoke('list-actions'),
  listGestures: (): Promise<Gesture[]> => ipcRenderer.invoke('list-gestures'),
  addGesture: (input: Omit<Gesture, 'id'>): Promise<Gesture[]> =>
    ipcRenderer.invoke('add-gesture', input),
  deleteGesture: (id: string): Promise<Gesture[]> => ipcRenderer.invoke('delete-gesture', id),
  getScreenSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('screen-size'),
  moveCursor: (x: number, y: number): void => ipcRenderer.send('move-cursor', x, y),
  clickMouse: (): void => ipcRenderer.send('click-mouse'),

  startVoiceSession: (): Promise<string> => ipcRenderer.invoke('start-voice-session'),
  stopVoiceSession: (): Promise<string> => ipcRenderer.invoke('stop-voice-session'),
  sendVoiceChunk: (chunk: ArrayBuffer): void => ipcRenderer.send('voice-audio-chunk', chunk),
  transcribeVoiceSample: (wavBuffer: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('transcribe-voice-sample', wavBuffer),
  listVoiceCommands: (): Promise<VoiceCommand[]> => ipcRenderer.invoke('list-voice-commands'),
  addVoiceCommand: (input: Omit<VoiceCommand, 'id'>): Promise<VoiceCommand[]> =>
    ipcRenderer.invoke('add-voice-command', input),
  deleteVoiceCommand: (id: string): Promise<VoiceCommand[]> =>
    ipcRenderer.invoke('delete-voice-command', id),
  onVoiceEvent: (callback: (event: VoiceSessionEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, voiceEvent: VoiceSessionEvent): void =>
      callback(voiceEvent)
    ipcRenderer.on('voice-event', listener)
    return () => ipcRenderer.removeListener('voice-event', listener)
  }
})
