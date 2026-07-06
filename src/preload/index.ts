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
//   // @ts-ignore (define in dts)
//   window.electron = electronAPI
//   // @ts-ignore (define in dts)
//   window.api = api
// }

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('qvacAPI', {
  loadModel: (): Promise<string> => ipcRenderer.invoke('load-model'),
  unloadModel: (): Promise<string> => ipcRenderer.invoke('unload-model'),
  saveFrame: (buffer: ArrayBuffer): Promise<string> => ipcRenderer.invoke('save-frame', buffer),
  classifyGesture: (framePath: string): Promise<{ gesture: string; raw: string }> =>
    ipcRenderer.invoke('classify-gesture', framePath)
})
