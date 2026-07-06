// import { ElectronAPI } from '@electron-toolkit/preload'

// declare global {
//   interface Window {
//     electron: ElectronAPI
//     api: unknown
//   }
// }
declare global {
  interface Window {
    qvacAPI: {
      loadModel: () => Promise<string>
      unloadModel: () => Promise<string>
      saveFrame: (buffer: ArrayBuffer) => Promise<string>
      classifyGesture: (framePath: string) => Promise<{ gesture: string; raw: string }>
    }
  }
}

export {}
