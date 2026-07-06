// import { app, shell, BrowserWindow, ipcMain } from 'electron'
// import { join } from 'path'
// import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// import icon from '../../resources/icon.png?asset'

// function createWindow(): void {
//   // Create the browser window.
//   const mainWindow = new BrowserWindow({
//     width: 900,
//     height: 670,
//     show: false,
//     autoHideMenuBar: true,
//     ...(process.platform === 'linux' ? { icon } : {}),
//     webPreferences: {
//       preload: join(__dirname, '../preload/index.js'),
//       sandbox: false
//     }
//   })

//   mainWindow.on('ready-to-show', () => {
//     mainWindow.show()
//   })

//   mainWindow.webContents.setWindowOpenHandler((details) => {
//     shell.openExternal(details.url)
//     return { action: 'deny' }
//   })

//   // HMR for renderer base on electron-vite cli.
//   // Load the remote URL for development or the local html file for production.
//   if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
//     mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
//   } else {
//     mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
//   }
// }

// // This method will be called when Electron has finished
// // initialization and is ready to create browser windows.
// // Some APIs can only be used after this event occurs.
// app.whenReady().then(() => {
//   // Set app user model id for windows
//   electronApp.setAppUserModelId('com.electron')

//   // Default open or close DevTools by F12 in development
//   // and ignore CommandOrControl + R in production.
//   // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
//   app.on('browser-window-created', (_, window) => {
//     optimizer.watchWindowShortcuts(window)
//   })

//   // IPC test
//   ipcMain.on('ping', () => console.log('pong'))

//   createWindow()

//   app.on('activate', function () {
//     // On macOS it's common to re-create a window in the app when the
//     // dock icon is clicked and there are no other windows open.
//     if (BrowserWindow.getAllWindows().length === 0) createWindow()
//   })
// })

// // Quit when all windows are closed, except on macOS. There, it's common
// // for applications and their menu bar to stay active until the user quits
// // explicitly with Cmd + Q.
// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit()
//   }
// })

// // In this file you can include the rest of your app's specific main process
// // code. You can also put them in separate files and require them here.

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import robot from 'robotjs'
import {
  QWEN3VL_2B_MULTIMODAL_Q4_K,
  MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
  loadModel,
  unloadModel,
  completion,
  profiler
} from '@qvac/sdk'

app.commandLine.appendSwitch('no-sandbox')
profiler.enable({ mode: 'verbose' })

let win: BrowserWindow | null = null
let modelId: string | null = null
let lastGesture: string | null = null
let consecutiveCount = 0
let classifyCallCount = 0

function createWindow(): void {
  win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win!.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupHandlers(): void {
  ipcMain.handle('load-model', async () => {
    modelId = await loadModel({
      modelSrc: QWEN3VL_2B_MULTIMODAL_Q4_K,
      modelConfig: {
        ctx_size: 2048,
        projectionModelSrc: MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K
      },
      onProgress: (progress) => console.log(progress)
    })
    return 'model loaded'
  })

  ipcMain.handle('infer', async (_event, history) => {
    if (!modelId) throw new Error('Model not loaded.')

    const result = completion({ modelId, history, stream: true })
    for await (const token of result.tokenStream) {
      win?.webContents.send('completion-stream', token)
    }
    win?.webContents.send('completion-stream', '')
  })

  ipcMain.handle('unload-model', async () => {
    if (!modelId) throw new Error('Model not loaded.')
    await unloadModel({ modelId })
    modelId = null
    return 'model unloaded'
  })

  ipcMain.handle('save-frame', async (_event, buffer: ArrayBuffer) => {
    const framePath = join(tmpdir(), 'frame.jpg')
    await writeFile(framePath, Buffer.from(buffer))
    return framePath
  })

  ipcMain.handle('classify-gesture', async (_event, framePath: string) => {
    if (!modelId) throw new Error('Model not loaded.')

    const run = completion({
      modelId,
      history: [
        {
          role: 'user',
          content:
            'Look closely at the image. If a hand is shown as a closed fist, reply with exactly the word FIST. If a hand is shown open with fingers spread apart, like a stop gesture or a high five, reply with exactly the word PALM. If no hand is clearly shown (for example a face or an object), reply with exactly the word NONE.',
          attachments: [{ path: framePath }]
        }
      ],
      stream: false,
      generationParams: { temp: 0 }
    })

    const final = await run.final
    console.log('classify-gesture raw reply:', JSON.stringify(final.contentText))

    const upper = final.contentText.toUpperCase()
    const hasPalm = upper.includes('PALM')
    const hasFist = upper.includes('FIST')
    const hasNone = upper.includes('NONE')
    const gesture =
      hasPalm && !hasFist && !hasNone
        ? 'PALM'
        : hasFist && !hasPalm && !hasNone
          ? 'FIST'
          : 'UNKNOWN'

    if (gesture !== 'UNKNOWN' && gesture === lastGesture) {
      consecutiveCount += 1
    } else {
      lastGesture = gesture
      consecutiveCount = gesture === 'UNKNOWN' ? 0 : 1
    }

    // Debounce: only act the moment a gesture is confirmed twice in a row,
    // not on every subsequent poll while it's still being held.
    const debounced = consecutiveCount === 2

    try {
      if (debounced && gesture === 'PALM') {
        const pos = robot.getMousePos()
        robot.moveMouse(pos.x + 50, pos.y)
      } else if (debounced && gesture === 'FIST') {
        robot.mouseClick()
      }
    } catch (err) {
      console.warn('robotjs action failed:', err instanceof Error ? err.message : err)
    }

    classifyCallCount += 1
    if (classifyCallCount % 5 === 0) {
      console.log(profiler.exportTable())
    }

    return gesture
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  setupHandlers()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
