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
      infer: (history: { role: string; content: string }[]) => Promise<void>
      onCompletionStream: (cb: (token: string) => void) => void
      unloadModel: () => Promise<string>
      saveFrame: (buffer: ArrayBuffer) => Promise<string>
      classifyGesture: (framePath: string) => Promise<string>
    }
  }
}

export {}
