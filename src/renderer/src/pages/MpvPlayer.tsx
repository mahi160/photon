import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery } from '../lib/queries'
import { directStreamUrl, itemTitle } from '../lib/jellyfin'
import { resolvePlayable } from '../player/usePlayback'
import {
  reportProgress,
  reportStart,
  reportStopped,
  startPlayback,
  type PlaybackSession
} from '../player/session'
import styles from './Player.module.css'

// External-player mode: mpv owns the window and all controls; Photon starts the
// session, hands mpv the untranscoded stream and reports progress to Jellyfin.
// ponytail: audio/subtitle choice happens inside mpv; server-side external
// subtitle files aren't passed along. Autoplay-next doesn't apply here.
interface Props {
  startOverride?: number // web → mpv handoff resumes at the built-in player's position
  onFallback?: () => void
  // mpv has no OS-integrated Picture-in-Picture (no libmpv hook into the
  // system PiP surface) — the honest way to get real PiP is to hand off to
  // the built-in player, which the server can always transcode for
  onRequestPiP?: (positionSeconds: number) => void
}

// mpv window knobs, driven over the IPC socket. State is optimistic — mpv has
// no failure mode here worth round-tripping for, and mpv's own UI can't
// change these behind our back (no keybindings for ontop/window-scale by
// default; fullscreen falls back in sync on the next toggle).
function MpvWindowControls(): React.JSX.Element {
  const [onTop, setOnTop] = useState(false)
  const [scale, setScale] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  return (
    <div className={styles.mpvControls}>
      <button
        className={`${styles.mpvBtn} ${onTop ? styles.mpvBtnActive : ''}`}
        onClick={() => {
          setOnTop(!onTop)
          void window.api.mpvSet('ontop', !onTop)
        }}
      >
        Always on top
      </button>
      {([0.5, 1, 2] as const).map((s) => (
        <button
          key={s}
          className={`${styles.mpvBtn} ${!fullscreen && scale === s ? styles.mpvBtnActive : ''}`}
          onClick={() => {
            setScale(s)
            setFullscreen(false)
            void window.api.mpvSet('fullscreen', false)
            void window.api.mpvSet('window-scale', s)
          }}
        >
          {s * 100}%
        </button>
      ))}
      <button
        className={`${styles.mpvBtn} ${fullscreen ? styles.mpvBtnActive : ''}`}
        onClick={() => {
          setFullscreen(!fullscreen)
          void window.api.mpvSet('fullscreen', !fullscreen)
        }}
      >
        Fullscreen
      </button>
    </div>
  )
}

export function MpvPlayer({ startOverride, onFallback, onRequestPiP }: Props): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ from: '/app/player/$itemId' })
  const navigate = useNavigate()
  const item = useQuery(itemQuery(itemId))

  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sessRef = useRef<PlaybackSession | null>(null)
  const lastPos = useRef(0)
  const startedFor = useRef<string | null>(null)
  const pipping = useRef(false) // suppress the running->false poll tick during handoff

  useEffect(() => {
    const it = item.data
    if (!it || startedFor.current === it.Id) return
    startedFor.current = it.Id
    void (async () => {
      try {
        const playable = await resolvePlayable(it)
        const sess = await startPlayback(playable, { startSeconds: startOverride ?? search.start })
        const t = itemTitle(playable)
        setTitle(t)
        lastPos.current = sess.startSeconds
        // mpv decodes anything locally — always hand it the direct stream
        const ok = await window.api.mpvPlay({
          url: directStreamUrl(playable.Id, sess.mediaSource.Id),
          start: sess.startSeconds,
          title: t
        })
        if (!ok) {
          setError('mpv not found. Install mpv or turn off "Use mpv" in Settings.')
          return
        }
        sessRef.current = sess
        reportStart(sess, sess.startSeconds)
      } catch {
        setError('Playback failed.')
      }
    })()
  }, [item.data, search.start, startOverride])

  // progress every 5s; when the mpv window closes, report stopped and go home
  useEffect(() => {
    const id = setInterval(async () => {
      const sess = sessRef.current
      if (!sess || pipping.current) return
      const st = await window.api.mpvStatus()
      if (st.running) {
        lastPos.current = st.timePos
        reportProgress(sess, st.timePos, st.paused)
      } else {
        sessRef.current = null
        reportStopped(sess, lastPos.current)
        navigate({ to: '/' })
      }
    }, 5000)
    return () => clearInterval(id)
  }, [navigate])

  async function requestPiP(): Promise<void> {
    pipping.current = true
    const st = await window.api.mpvStatus()
    await window.api.mpvStop()
    const sess = sessRef.current
    sessRef.current = null
    if (sess) reportStopped(sess, st.timePos)
    onRequestPiP?.(st.timePos)
  }

  // leaving the page stops mpv and closes the Jellyfin session
  useEffect(() => {
    return () => {
      const sess = sessRef.current
      sessRef.current = null
      if (sess) reportStopped(sess, lastPos.current)
      void window.api.mpvStop()
    }
  }, [])

  return (
    <div className={styles.stage}>
      <div className={styles.errorLayer}>
        {error ? (
          <>
            <p className={styles.errorText}>{error}</p>
            {onFallback && (
              <button onClick={onFallback} className={styles.errorRetry}>
                Use built-in player
              </button>
            )}
          </>
        ) : (
          <>
            <p className={styles.errorText}>
              {title ? `Playing in mpv — ${title}` : 'Starting mpv…'}
            </p>
            {title && <MpvWindowControls />}
          </>
        )}
        <button onClick={() => navigate({ to: '/' })} className={styles.errorBack}>
          Back to Home
        </button>
        {!error && onRequestPiP && (
          <button onClick={() => void requestPiP()} className={styles.errorBack}>
            Picture-in-Picture (switches to transcode)
          </button>
        )}
      </div>
    </div>
  )
}
