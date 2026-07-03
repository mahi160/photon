import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, rmSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// --- secure session storage (token never touches plaintext disk) ---
const sessionFile = (): string => join(app.getPath('userData'), 'session.bin')

ipcMain.handle('session:get', () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(sessionFile()))
  } catch {
    return null
  }
})

ipcMain.handle('session:set', (_e, value: string) => {
  // ponytail: no plaintext fallback — if keychain unavailable, session is memory-only
  if (!safeStorage.isEncryptionAvailable()) return false
  writeFileSync(sessionFile(), safeStorage.encryptString(value))
  return true
})

ipcMain.handle('session:clear', () => {
  try {
    rmSync(sessionFile())
  } catch {
    /* already gone */
  }
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    title: 'Famto',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.famto')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
