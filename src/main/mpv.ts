import { app, ipcMain, powerSaveBlocker } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createConnection, type Socket } from 'net'
import { existsSync } from 'fs'
import { join } from 'path'

// External mpv integration: spawn mpv with a JSON IPC socket, observe
// time-pos/pause so the renderer can report playback progress to Jellyfin.
// mpv owns all playback UI; Photon only tracks position and lifetime.

export interface MpvStatus {
  running: boolean
  timePos: number
  paused: boolean
}

const socketPath =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\photon-mpv'
    : join(app.getPath('temp'), 'photon-mpv.sock')

let proc: ChildProcess | null = null
let sock: Socket | null = null
let status: MpvStatus = { running: false, timePos: 0, paused: false }

// keep the display awake while mpv plays — Photon's own window is idle then,
// so Chromium's usual video-playback wake lock doesn't apply
let sleepBlocker: number | null = null
function releaseSleepBlocker(): void {
  if (sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = null
  }
}

function findMpv(): string {
  if (process.platform === 'darwin') {
    // GUI apps on macOS don't inherit the shell PATH (homebrew arm/intel, macports)
    for (const p of ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/opt/local/bin/mpv'])
      if (existsSync(p)) return p
  }
  if (process.platform === 'win32') {
    // manual installs commonly aren't on PATH (scoop/choco shims are)
    for (const p of [
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'mpv', 'mpv.exe'),
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'mpv', 'mpv.exe'),
      join(app.getPath('home'), 'scoop', 'shims', 'mpv.exe')
    ])
      if (existsSync(p)) return p
  }
  return 'mpv'
}

// cached availability probe — lets the renderer avoid routing playback to a
// player that isn't installed (auto mode falls back to the built-in player).
// Only success is cached: a negative result re-probes, so installing mpv
// mid-session works without an app restart.
let mpvAvailable = false
async function checkMpv(): Promise<boolean> {
  if (mpvAvailable) return true
  mpvAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn(findMpv(), ['--version'], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.kill()
      resolve(true)
    })
  })
  return mpvAvailable
}

function connect(attempt = 0): void {
  if (!proc) return
  const s = createConnection(socketPath)
  let buf = ''
  s.on('connect', () => {
    sock = s
    s.write('{"command":["observe_property",1,"time-pos"]}\n')
    s.write('{"command":["observe_property",2,"pause"]}\n')
  })
  s.on('data', (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.event === 'property-change') {
          if (msg.name === 'time-pos' && typeof msg.data === 'number') status.timePos = msg.data
          if (msg.name === 'pause') status.paused = Boolean(msg.data)
        }
      } catch {
        /* not our message */
      }
    }
  })
  s.on('error', () => {
    s.destroy()
    // the socket only exists once mpv is up — retry briefly
    if (sock !== s && attempt < 20) setTimeout(() => connect(attempt + 1), 250)
  })
}

function stop(): void {
  releaseSleepBlocker()
  sock?.destroy()
  sock = null
  proc?.kill()
  proc = null
  status = { running: false, timePos: 0, paused: false }
}

export function registerMpv(): void {
  ipcMain.handle(
    'mpv:play',
    async (
      _e,
      opts: { url: string; start: number; title: string; subs?: string[] }
    ): Promise<boolean> => {
      stop()
      const child = spawn(
        findMpv(),
        [
          `--input-ipc-server=${socketPath}`,
          `--start=${opts.start}`,
          `--force-media-title=${opts.title}`,
          // server-side external subtitles; mpv parses vtt/srt natively
          ...(opts.subs ?? []).map((u) => `--sub-file=${u}`),
          '--no-terminal',
          '--border=no', // no titlebar/chrome — keeps mpv's own OSC for scrubbing
          // hides the Dock icon and global menu bar so mpv doesn't look like a
          // second, unrelated app taking over macOS's menu bar
          ...(process.platform === 'darwin' ? ['--macos-app-activation-policy=accessory'] : []),
          opts.url
        ],
        { stdio: 'ignore' }
      )
      const ok = await new Promise<boolean>((resolve) => {
        child.once('spawn', () => resolve(true))
        child.once('error', () => resolve(false)) // mpv not installed
      })
      if (!ok) return false
      proc = child
      status = { running: true, timePos: opts.start, paused: false }
      sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
      child.on('exit', () => {
        if (proc === child) {
          releaseSleepBlocker()
          sock?.destroy()
          sock = null
          proc = null
          status = { ...status, running: false }
        }
      })
      setTimeout(() => connect(), 300)
      return true
    }
  )

  // window-level knobs the renderer may flip while mpv plays. Whitelisted so
  // the renderer can't drive arbitrary mpv commands through the socket.
  const settable = new Set(['ontop', 'window-scale', 'fullscreen', 'pause'])
  ipcMain.handle('mpv:set', (_e, prop: string, value: boolean | number): boolean => {
    if (!sock || !settable.has(prop) || (typeof value !== 'boolean' && typeof value !== 'number'))
      return false
    sock.write(JSON.stringify({ command: ['set_property', prop, value] }) + '\n')
    return true
  })

  ipcMain.handle('mpv:status', (): MpvStatus => status)
  ipcMain.handle('mpv:stop', () => stop())
  ipcMain.handle('mpv:check', () => checkMpv())

  app.on('will-quit', stop)
}
