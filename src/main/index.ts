import { app, shell, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerMpv } from './mpv'
import type { UpdaterStatus } from '../preload/index'

registerMpv()

const prefsFile = join(app.getPath('userData'), 'prefs.json')

function readPrefs(): { disableHwAccel?: boolean; disableAutoUpdate?: boolean } {
  try {
    return existsSync(prefsFile) ? JSON.parse(readFileSync(prefsFile, 'utf-8')) : {}
  } catch {
    return {} /* corrupt prefs: ignore */
  }
}

// hardware acceleration flag must be applied before app is ready
if (readPrefs().disableHwAccel) app.disableHardwareAcceleration()

// --- secure session storage (token never touches plaintext disk) ---
const sessionFile = (): string => join(app.getPath('userData'), 'session.bin')

// the signed-in server's origin — scopes the subtitle:fetch proxy below so
// the renderer can't use main as an arbitrary URL fetcher
let serverOrigin: string | null = null
function rememberOrigin(sessionJson: string): void {
  try {
    serverOrigin = new URL(JSON.parse(sessionJson).server).origin
  } catch {
    serverOrigin = null
  }
}

ipcMain.handle('session:get', () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const value = safeStorage.decryptString(readFileSync(sessionFile()))
    rememberOrigin(value)
    return value
  } catch {
    return null
  }
})

ipcMain.handle('session:set', (_e, value: string) => {
  rememberOrigin(value)
  // ponytail: no plaintext fallback — if keychain unavailable, session is memory-only
  if (!safeStorage.isEncryptionAvailable()) return false
  writeFileSync(sessionFile(), safeStorage.encryptString(value))
  return true
})

ipcMain.handle('session:clear', () => {
  serverOrigin = null
  try {
    rmSync(sessionFile())
  } catch {
    /* already gone */
  }
})

ipcMain.handle('app:version', () => app.getVersion())

// PiP: the floating video window survives a minimized main window, so the
// player minimizes on PiP enter and restores on exit
ipcMain.handle('app:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())

ipcMain.handle('app:restore', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win?.isMinimized()) win.restore()
  win?.focus()
})

ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: enabled })
})

ipcMain.handle('app:getLoginItem', () => app.getLoginItemSettings().openAtLogin)

function writePrefs(patch: Partial<ReturnType<typeof readPrefs>>): void {
  writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), ...patch }))
}

ipcMain.handle('app:setHwAccel', (_e, enabled: boolean) => {
  // takes effect on next launch
  writePrefs({ disableHwAccel: !enabled })
})

ipcMain.handle('app:getHwAccel', () => !readPrefs().disableHwAccel)

ipcMain.handle('app:setAutoUpdate', (_e, enabled: boolean) => {
  writePrefs({ disableAutoUpdate: !enabled })
})

ipcMain.handle('app:getAutoUpdate', () => !readPrefs().disableAutoUpdate)

// pushed to Settings > About so update state is actually visible instead of
// living only in a native OS notification the user can miss/dismiss
let updaterStatus: UpdaterStatus = { state: 'idle' }

function broadcastUpdaterStatus(status: UpdaterStatus): void {
  updaterStatus = status
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updater:status', status)
}

ipcMain.handle('updater:status', () => updaterStatus)

ipcMain.handle('updater:install', () => {
  void import('electron-updater').then(({ autoUpdater }) => autoUpdater.quitAndInstall())
})

// Subtitle VTT fetched from main: renderer <track> fetches are subject to
// CORS (needs Access-Control-Allow-Origin from the user's server/reverse
// proxy); a Node-side fetch has no such restriction. Text only, small files.
ipcMain.handle('subtitle:fetch', async (_e, url: string): Promise<string> => {
  if (!serverOrigin || new URL(url).origin !== serverOrigin)
    throw new Error('Subtitle URL not on the signed-in server')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
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
    title: 'Photon',
    // macOS packaged app uses build/icon.icns from the bundle instead; the
    // BrowserWindow icon option only does something on Linux/Windows
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // contextIsolation stays on (default) and the preload only exposes the
      // whitelisted `api`/`electron` bridges above — sandbox is off solely
      // because @electron-toolkit/preload needs non-sandboxed Node APIs at load time
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
  electronApp.setAppUserModelId('dev.photon')

  // dev runs launch the bare Electron binary, so there's no .app bundle to
  // read build/icon.icns from — set the Dock icon by hand or it shows Electron's
  if (is.dev && process.platform === 'darwin') app.dock?.setIcon(icon)

  if (!is.dev && !readPrefs().disableAutoUpdate) {
    void import('electron-updater')
      .then(({ autoUpdater }) => {
        autoUpdater.on('checking-for-update', () => broadcastUpdaterStatus({ state: 'checking' }))
        autoUpdater.on('update-not-available', () =>
          broadcastUpdaterStatus({ state: 'not-available' })
        )
        autoUpdater.on('update-available', (info) =>
          broadcastUpdaterStatus({ state: 'available', version: info.version })
        )
        autoUpdater.on('update-downloaded', (info) =>
          broadcastUpdaterStatus({ state: 'downloaded', version: info.version })
        )
        autoUpdater.on('error', (err) =>
          broadcastUpdaterStatus({ state: 'error', message: err.message })
        )
        return autoUpdater.checkForUpdates()
      })
      .catch((err: Error) => broadcastUpdaterStatus({ state: 'error', message: err.message }))
  }

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
