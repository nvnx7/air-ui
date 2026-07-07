interface Gesture {
  id: string
  name: string
  description: string
  action: string
}

interface ActionInfo {
  id: string
  label: string
}

declare global {
  interface Window {
    qvacAPI: {
      loadModel: () => Promise<string>
      unloadModel: () => Promise<string>
      saveFrame: (buffer: ArrayBuffer) => Promise<string>
      describeGesture: (framePath: string) => Promise<string>
      recognizeGesture: (
        framePath: string,
        dwellFrames: number
      ) => Promise<{
        name: string | null
        raw: string
        progress: number
        threshold: number
        armed: boolean
        fired: boolean
      }>
      listActions: () => Promise<ActionInfo[]>
      listGestures: () => Promise<Gesture[]>
      addGesture: (input: Omit<Gesture, 'id'>) => Promise<Gesture[]>
      deleteGesture: (id: string) => Promise<Gesture[]>
      getScreenSize: () => Promise<{ width: number; height: number }>
      moveCursor: (x: number, y: number) => void
      clickMouse: () => void
    }
  }
}

export {}
