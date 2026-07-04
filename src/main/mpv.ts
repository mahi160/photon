import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createConnection, type Socket } from 'net'
import { existsSync } from 'fs'
import { join } from 'path'

// External mpv integration: spawn mpv with a JSON IPC socket, observe
// time-pos/pause so the renderer can report playback progress to Jellyfin.
// mpv owns all playback UI; Famto only tracks position and lifetime.

export interface MpvStatus {
  running: boolean
  timePos: number
  paused: boolean
}

const socketPath =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\famto-mpv'
    : join(app.getPath('temp'), 'famto-mpv.sock')

let proc: ChildProcess | null = null
let sock: Socket | null = null
let status: MpvStatus = { running: false, timePos: 0, paused: false }

function findMpv(): string {
  if (process.platform === 'darwin') {
    // GUI apps on macOS don't inherit the shell PATH
    for (const p of ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv']) if (existsSync(p)) return p
  }
  return 'mpv'
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
  sock?.destroy()
  sock = null
  proc?.kill()
  proc = null
  status = { running: false, timePos: 0, paused: false }
}

export function registerMpv(): void {
  ipcMain.handle(
    'mpv:play',
    async (_e, opts: { url: string; start: number; title: string }): Promise<boolean> => {
      stop()
      const child = spawn(
        findMpv(),
        [
          `--input-ipc-server=${socketPath}`,
          `--start=${opts.start}`,
          `--force-media-title=${opts.title}`,
          '--no-terminal',
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
      child.on('exit', () => {
        if (proc === child) {
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

  ipcMain.handle('mpv:status', (): MpvStatus => status)
  ipcMain.handle('mpv:stop', () => stop())

  app.on('will-quit', stop)
}
