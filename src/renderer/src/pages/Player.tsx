import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemQuery, mediaSegmentsQuery } from '../lib/queries'
import { currentSession, jf, ticksToSeconds, type ItemsResult } from '../lib/jellyfin'
import { resolvePlayable, usePlayback } from '../player/usePlayback'
import { canDirectPlay } from '../player/session'
import { useSettings } from '../stores/settings'
import { PlayerControls } from '../components/PlayerControls'
import { SubtitleStyleTag } from '../components/SubtitleStyleTag'
import { useHotkeys } from '../lib/useHotkeys'
import { useToast } from '../hooks/useToast'
import { useMediaSession } from '../hooks/useMediaSession'
import { useAutoHideControls } from '../hooks/useAutoHideControls'
import { queryKeys } from '../lib/queryKeys'
import { MpvPlayer } from './MpvPlayer'
import styles from './Player.module.css'

// One state machine for player routing: engine is 'web', 'mpv', or null while
// the 'auto' probe is in flight. mpv falling over (not installed) or a PiP
// request both collapse to the built-in player — setEngine('web') is the only
// transition. 'auto' probes the server once: direct play stays in the
// built-in player, anything that would transcode is handed to mpv (which
// plays the original file).
// ponytail: decided at play start only — a mid-session reload that flips to
// transcoding (e.g. an audio switch) stays in the built-in player.
export function Player(): React.JSX.Element {
  const mode = useSettings((s) => s.playerMode)
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ from: '/app/player/$itemId' })
  const navigate = useNavigate()
  const [engine, setEngine] = useState<'web' | 'mpv' | null>(mode === 'auto' ? null : mode)
  // handoffs in either direction resume the other player at the last position
  const [resume, setResume] = useState<number | undefined>(undefined)
  const handoff = (to: 'web' | 'mpv') => (pos: number) => {
    setResume(pos)
    setEngine(to)
  }
  const [failed, setFailed] = useState(false)
  const item = useQuery({ ...itemQuery(itemId), enabled: engine === null })
  const probedFor = useRef<string | null>(null)

  useEffect(() => {
    const it = item.data
    if (engine !== null || !it || probedFor.current === it.Id) return
    probedFor.current = it.Id
    const settings = useSettings.getState()
    // probe and availability check are independent — run them together; never
    // route to a player that isn't installed (the server can transcode for
    // the built-in player instead)
    Promise.all([
      resolvePlayable(it).then((playable) =>
        canDirectPlay(playable, {
          audioStreamIndex: search.audio,
          subtitleStreamIndex: search.sub,
          maxBitrate: settings.maxBitrate || undefined
        })
      ),
      window.api.mpvCheck()
    ])
      .then(([direct, mpvOk]) => setEngine(!direct && mpvOk ? 'mpv' : 'web'))
      .catch(() => setFailed(true))
  }, [engine, item.data, search.audio, search.sub])

  if (engine === 'mpv')
    return (
      <MpvPlayer
        startOverride={resume}
        onFallback={() => setEngine('web')}
        onRequestPiP={handoff('web')}
      />
    )
  if (engine === 'web') return <WebPlayer startOverride={resume} onOpenMpv={handoff('mpv')} />
  return (
    <div className={styles.stage}>
      {failed && (
        <div className={styles.errorLayer}>
          <p className={styles.errorText}>Playback failed.</p>
          <button onClick={() => navigate({ to: '/' })} className={styles.errorBack}>
            Back to Home
          </button>
        </div>
      )}
    </div>
  )
}

function WebPlayer({
  startOverride,
  onOpenMpv
}: {
  startOverride?: number
  onOpenMpv?: (pos: number) => void
}): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const routeSearch = useSearch({ from: '/app/player/$itemId' })
  const search =
    startOverride !== undefined ? { ...routeSearch, start: startOverride } : routeSearch
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null)
  const item = useQuery(itemQuery(itemId))
  const player = usePlayback(videoRef, item.data, search)
  const { engine, session } = player

  // only offer the mpv handoff when mpv is actually installed
  const [mpvOk, setMpvOk] = useState(false)
  useEffect(() => {
    void window.api.mpvCheck().then(setMpvOk)
  }, [])

  // extract toast and auto-hide controls
  const { message: toast, show: showToast } = useToast(1200)
  const { visible, setPinned, poke } = useAutoHideControls(engine.state)

  // real fullscreen state (Esc exits natively; icon must follow), and never
  // strand the app in fullscreen when leaving the player
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onFs = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) void document.exitFullscreen()
    }
  }, [])

  // PiP floats its own always-on-top window — minimize the app behind it on
  // enter, bring it back on exit
  const prevPip = useRef(false)
  useEffect(() => {
    if (engine.pip && !prevPip.current) void window.api.minimizeWindow()
    else if (!engine.pip && prevPip.current) void window.api.restoreWindow()
    prevPip.current = engine.pip
  }, [engine.pip])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  // stable identities: these feed the player's track-select menus, which are
  // memoized to skip re-rendering on every playback tick (base-ui popovers
  // aren't cheap to reconcile dozens of times a minute for nothing)
  const bumpVolume = useCallback(
    (delta: number): void => {
      const v = Math.max(0, Math.min(1, engine.volume + delta))
      engine.changeVolume(v)
      showToast(`Volume ${Math.round(v * 100)}%`)
    },
    [engine.volume, engine.changeVolume, showToast]
  )

  const toggleMuteWithToast = useCallback((): void => {
    const next = !engine.muted
    engine.toggleMute()
    showToast(next ? 'Muted' : 'Unmuted')
  }, [engine.muted, engine.toggleMute, showToast])

  // subtitle sync: shift delay by the same step as the slider, text subs only
  const shiftSubtitleDelay = useCallback(
    (step: number): void => {
      if (player.subtitleIndex === null || !player.subtitleIsText) return
      const d = Math.max(-10, Math.min(10, player.subtitleDelay + step))
      player.changeDelay(d)
      showToast(`Subtitle delay: ${d > 0 ? '+' : ''}${d.toFixed(1)}s`)
    },
    [
      player.subtitleIndex,
      player.subtitleIsText,
      player.subtitleDelay,
      player.changeDelay,
      showToast
    ]
  )

  // a burned-in pick reloads the stream (server transcode start can take a
  // few seconds) — say so, instead of leaving the picker looking unresponsive
  const selectSubtitle = useCallback(
    (index: number | null): void => {
      player.selectSubtitle(index)
      if (index === null) {
        showToast('Subtitles off')
        return
      }
      const stream = session?.subtitleStreams.find((s) => s.Index === index)
      const label = stream?.DisplayTitle ?? `Subtitle ${index}`
      showToast(
        stream?.DeliveryMethod !== 'External' ? `Switching to ${label}…` : `Subtitles: ${label}`
      )
    },
    [player.selectSubtitle, session, showToast]
  )

  // the episode after the one playing (dock's next button); NextUp can't be
  // used here — mid-episode it still points at the current one
  const playing = player.session?.item
  // server-detected intro/outro ranges (Jellyfin 10.9+, empty on older servers)
  const segments = useQuery({ ...mediaSegmentsQuery(playing?.Id ?? ''), enabled: !!playing })
  const timeTicks = engine.time * 10_000_000
  const activeSegment = segments.data?.find(
    (s) => s.Type !== 'Unknown' && timeTicks >= s.StartTicks && timeTicks < s.EndTicks
  )
  const nextEp = useQuery({
    queryKey: [...queryKeys.item.adjacent(playing?.Id ?? ''), 'next'],
    enabled: playing?.Type === 'Episode' && !!playing.SeriesId,
    staleTime: Infinity,
    queryFn: async () => {
      const r = await jf<ItemsResult>(`/Shows/${playing!.SeriesId}/Episodes`, {
        query: { userId: currentSession()?.userId ?? '', adjacentTo: playing!.Id }
      })
      const i = r.Items.findIndex((x) => x.Id === playing!.Id)
      return i >= 0 ? (r.Items[i + 1] ?? null) : null
    }
  })
  const prevEp = useQuery({
    queryKey: [...queryKeys.item.adjacent(playing?.Id ?? ''), 'prev'],
    enabled: playing?.Type === 'Episode' && !!playing.SeriesId,
    staleTime: Infinity,
    queryFn: async () => {
      const r = await jf<ItemsResult>(`/Shows/${playing!.SeriesId}/Episodes`, {
        query: { userId: currentSession()?.userId ?? '', adjacentTo: playing!.Id }
      })
      const i = r.Items.findIndex((x) => x.Id === playing!.Id)
      return i > 0 ? (r.Items[i - 1] ?? null) : null
    }
  })

  // OS media keys / overlay buttons with explicit handlers
  useMediaSession({
    togglePlay: engine.togglePlay,
    seekBy: engine.seekBy,
    playItem: player.playItem,
    prevEpisode: prevEp.data ?? null,
    nextEpisode: nextEp.data ?? null
  })

  // keyboard shortcuts (PRD: Navigation); repeat-guarded where holding the
  // key would flap the state instead of progressing it
  useHotkeys(
    {
      space: (e) => {
        if (!e.repeat) engine.togglePlay()
      },
      arrowleft: () => {
        engine.seekBy(-10)
        poke()
      },
      arrowright: () => {
        engine.seekBy(10)
        poke()
      },
      arrowup: () => bumpVolume(0.05),
      arrowdown: () => bumpVolume(-0.05),
      f: (e) => {
        if (!e.repeat) toggleFullscreen()
      },
      p: (e) => {
        if (!e.repeat) engine.togglePiP()
      },
      m: (e) => {
        if (!e.repeat) toggleMuteWithToast()
      },
      '[': () => shiftSubtitleDelay(-0.5),
      ']': () => shiftSubtitleDelay(0.5)
    },
    [engine, toggleFullscreen, player.subtitleIndex, player.subtitleDelay, player.subtitleIsText]
  )

  // stable identities for the same reason as the callbacks above — these
  // feed menu/button props on the memoized part of the controls bar
  const playNextEpisode = useMemo(
    () => (nextEp.data ? () => void player.playItem(nextEp.data!) : undefined),
    [nextEp.data, player.playItem]
  )
  const openMpvAtCurrentTime = useMemo(
    () => (onOpenMpv && mpvOk ? () => onOpenMpv(engine.currentTime()) : undefined),
    [onOpenMpv, mpvOk, engine.currentTime]
  )

  const displayDuration = engine.duration || ticksToSeconds(session?.mediaSource.RunTimeTicks)

  return (
    <div
      className={styles.stage}
      onMouseMove={poke}
      onClick={() => {
        // controls hidden = their click layer is inert; don't eat the click
        if (!visible) {
          engine.togglePlay()
          poke()
        }
      }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement
        if (t === e.currentTarget || t.tagName === 'VIDEO') toggleFullscreen()
      }}
      style={{ cursor: visible ? 'default' : 'none' }}
    >
      <SubtitleStyleTag />
      <video ref={videoRef} className={styles.video} />
      {player.error && (
        <div className={styles.errorLayer}>
          <p className={styles.errorText}>{player.error}</p>
          <button
            onClick={() => {
              player.retry()
              item.refetch()
            }}
            className={styles.errorRetry}
          >
            Retry
          </button>
          <button onClick={() => navigate({ to: '/' })} className={styles.errorBack}>
            Back to Home
          </button>
        </div>
      )}
      {!player.error && session && (
        <PlayerControls
          visible={visible}
          item={session.item}
          playMethod={session.playMethod}
          state={engine.state}
          time={engine.time}
          duration={displayDuration}
          bufferedEnd={engine.bufferedEnd}
          volume={engine.volume}
          muted={engine.muted}
          rate={engine.rate}
          pip={engine.pip}
          fullscreen={fullscreen}
          audioStreams={session.audioStreams}
          subtitleStreams={session.subtitleStreams}
          audioIndex={player.audioIndex ?? session.mediaSource.DefaultAudioStreamIndex}
          subtitleIndex={player.subtitleIndex}
          subtitleDelay={player.subtitleDelay}
          subtitleDelayEnabled={player.subtitleIsText && player.subtitleIndex !== null}
          nextEpisode={nextEp.data ?? undefined}
          onPlayNext={playNextEpisode}
          activeSegment={activeSegment}
          onSkipSegment={
            activeSegment ? () => engine.seek(ticksToSeconds(activeSegment.EndTicks)) : undefined
          }
          onPinChange={setPinned}
          onBack={() => navigate({ to: '/' })}
          onTogglePlay={engine.togglePlay}
          onSeek={engine.seek}
          onVolume={engine.changeVolume}
          onVolumeStep={bumpVolume}
          onMute={engine.toggleMute}
          onRate={player.changeRate}
          onSelectAudio={player.selectAudio}
          onSelectSubtitle={selectSubtitle}
          onSubtitleDelay={player.changeDelay}
          onFullscreen={toggleFullscreen}
          onPiP={engine.togglePiP}
          onOpenMpv={openMpvAtCurrentTime}
        />
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  )
}
