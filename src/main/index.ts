import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { initProfiler } from './profiler'

app.commandLine.appendSwitch('no-sandbox')
initProfiler()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron throttles rAF/timers (and the Page Visibility API) once the
      // window loses focus/is occluded — the whole point of this app is a
      // pointer/gesture/voice loop that keeps running while some other
      // window has focus, so that throttling must stay off.
      backgroundThrottling: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  registerIpcHandlers()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
