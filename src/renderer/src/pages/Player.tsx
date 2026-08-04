import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { itemQuery, mediaSegmentsQuery } from '../lib/queries'
import {
  currentSession,
  jf,
  playerSpecialBadges,
  secondsToTicks,
  ticksToSeconds,
  type ItemsResult
} from '../lib/jellyfin'
import { usePlayback } from '../player/usePlayback'
import { useSettings } from '../stores/settings'
import { PlayerControls } from '../components/PlayerControls'
import { speeds } from '../player/engine'
import { useHotkeys } from '../lib/useHotkeys'
import { useToast } from '../hooks/useToast'
import { useMediaSession } from '../hooks/useMediaSession'
import { useAutoHideControls } from '../hooks/useAutoHideControls'
import { useWakeLock } from '../hooks/useWakeLock'
import { queryKeys } from '../lib/queryKeys'
import { ShortcutsOverlay } from './Shortcuts'
import { PipOverlay } from '../components/PipOverlay'
import styles from './Player.module.css'

function segmentNoun(type: string): string {
  return type === 'Outro' ? 'credits' : type === 'Commercial' ? 'ad' : type.toLowerCase()
}

export function Player(): React.JSX.Element {
  const { itemId } = useParams({ from: '/app/player/$itemId' })
  const search = useSearch({ from: '/app/player/$itemId' })
  const navigate = useNavigate()

  // mpv composites into a native surface positioned under this placeholder's on-screen rect (ADR-0005)
  const videoRef = useRef<HTMLDivElement>(null)
  const item = useQuery(itemQuery(itemId))
  const player = usePlayback(videoRef, item.data, search)
  const { engine, session } = player
  // stable callbacks pulled out so hook deps name exactly what they use (depending on engine/player themselves would churn every render)
  const { adjustVolume, toggleMute, currentTime, seek } = engine
  const {
    subtitleIsText,
    subtitleDelay,
    changeDelay,
    selectSubtitle: playerSelectSubtitle,
    playItem
  } = player

  const { message: toast, show: showToast } = useToast(1200)
  const { visible, setPinned, poke } = useAutoHideControls(engine.state)
  useWakeLock(engine.state === 'playing')
  // native traffic-light dots (overlay title bar) are AppKit-drawn over the video, CSS opacity/pointer-events can't reach them -- this is the native-side echo of the same visible state
  useEffect(() => {
    void invoke('app_set_traffic_lights_visible', { visible })
  }, [visible])
  // always restored on the way out -- must never leak past the player route
  useEffect(() => {
    return () => void invoke('app_set_traffic_lights_visible', { visible: true })
  }, [])
  // AppLayout owns '?' + overlay elsewhere, but player route is chrome-free (outside AppLayout) -- needs its own copy to discover shortcuts while watching
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // Native OS window fullscreen (Tauri's set_fullscreen), not DOM Fullscreen API -- WebKit presents the fullscreen element in a separate window/layer the mpv NSView (composited under the original window, engine.rs) never gets carried into, showing no video and desyncing clicks. Native window fullscreen keeps everything in the same NSWindow so mpv keeps compositing correctly.
  const [fullscreen, setFullscreen] = useState(false)
  const fullscreenRef = useRef(false)
  useEffect(() => {
    fullscreenRef.current = fullscreen
  }, [fullscreen])
  // never strand the app in fullscreen on leaving the player -- no DOM auto-exit anymore, Esc handled explicitly below
  useEffect(() => {
    return () => {
      if (fullscreenRef.current) void invoke('app_set_fullscreen', { fullscreen: false })
    }
  }, [])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev
      void invoke('app_set_fullscreen', { fullscreen: next })
      return next
    })
  }, [])

  // stable identities: feed the player's memoized track-select menus (base-ui popovers aren't cheap to reconcile every playback tick)
  const bumpVolume = useCallback(
    (delta: number): void => {
      const v = adjustVolume(delta)
      showToast(`Volume ${Math.round(v * 100)}%`)
    },
    [adjustVolume, showToast]
  )

  const toggleMuteWithToast = useCallback((): void => {
    showToast(toggleMute() ? 'Muted' : 'Unmuted')
  }, [toggleMute, showToast])

  // subtitle sync: shift delay by same step as the slider, text subs only
  const shiftSubtitleDelay = useCallback(
    (step: number): void => {
      if (!subtitleIsText) return
      const d = Math.max(-10, Math.min(10, subtitleDelay + step))
      changeDelay(d)
      showToast(`Subtitle delay: ${d > 0 ? '+' : ''}${d.toFixed(1)}s`)
    },
    [subtitleIsText, subtitleDelay, changeDelay, showToast]
  )

  // burned-in pick reloads the stream (transcode start takes a few seconds) — say so, instead of picker looking unresponsive
  const selectSubtitle = useCallback(
    (index: number | null): void => {
      playerSelectSubtitle(index)
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
    [playerSelectSubtitle, session, showToast]
  )

  // episode after the one playing (dock's next button); NextUp can't be used here — mid-episode it still points at current one
  const playing = player.session?.item
  // server-detected intro/outro ranges (Jellyfin 10.9+, empty on older servers)
  const segments = useQuery({ ...mediaSegmentsQuery(playing?.Id ?? ''), enabled: !!playing })
  const timeTicks = secondsToTicks(engine.time)
  const activeSegment = segments.data?.find(
    (s) => s.Type !== 'Unknown' && timeTicks >= s.StartTicks && timeTicks < s.EndTicks
  )
  // auto-skip intros/recaps/previews (never credits — NextUpCard owns episode end). Skips once per item so seeking back into an intro on purpose doesn't fight the user.
  const autoSkip = useSettings((s) => s.autoSkipSegments)
  const autoSkipped = useRef(new Set<string>())
  useEffect(() => {
    if (!autoSkip || !activeSegment || activeSegment.Type === 'Outro' || !playing) return
    const key = `${playing.Id}:${activeSegment.StartTicks}`
    if (autoSkipped.current.has(key)) return
    autoSkipped.current.add(key)
    seek(ticksToSeconds(activeSegment.EndTicks))
    showToast(`Skipped ${segmentNoun(activeSegment.Type)}`)
  }, [autoSkip, activeSegment, playing, seek, showToast])

  // one fetch serves both directions — adjacentTo response contains them
  const adjacent = useQuery({
    queryKey: queryKeys.item.adjacent(playing?.Id ?? ''),
    enabled: playing?.Type === 'Episode' && !!playing.SeriesId,
    staleTime: Infinity,
    queryFn: async () => {
      const r = await jf<ItemsResult>(`/Shows/${playing!.SeriesId}/Episodes`, {
        query: { userId: currentSession()?.userId ?? '', adjacentTo: playing!.Id }
      })
      const i = r.Items.findIndex((x) => x.Id === playing!.Id)
      return {
        prev: i > 0 ? (r.Items[i - 1] ?? null) : null,
        next: i >= 0 ? (r.Items[i + 1] ?? null) : null
      }
    }
  })
  const nextEp = adjacent.data?.next ?? null
  const prevEp = adjacent.data?.prev ?? null

  // OS media keys / overlay buttons with explicit handlers
  useMediaSession({
    togglePlay: engine.togglePlay,
    seekBy: engine.seekBy,
    playItem: player.playItem,
    prevEpisode: prevEp,
    nextEpisode: nextEp
  })

  // keyboard shortcuts (PRD: Navigation); repeat-guarded where holding the key would flap state instead of progressing it
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
      escape: (e) => {
        // exit only, never enter fullscreen via Escape
        if (!e.repeat && fullscreen) toggleFullscreen()
      },
      p: (e) => {
        if (!e.repeat) engine.togglePiP()
      },
      m: (e) => {
        if (!e.repeat) toggleMuteWithToast()
      },
      s: (e) => {
        if (e.repeat || !activeSegment) return
        seek(ticksToSeconds(activeSegment.EndTicks))
        showToast(`Skipped ${segmentNoun(activeSegment.Type)}`)
      },
      'shift+arrowright': () => jumpChapter(1),
      'shift+arrowleft': () => jumpChapter(-1),
      'shift+>': () => stepSpeed(1),
      'shift+<': () => stepSpeed(-1),
      '[': () => shiftSubtitleDelay(-0.5),
      ']': () => shiftSubtitleDelay(0.5),
      a: (e) => {
        if (!e.repeat) cycleAudio()
      },
      c: (e) => {
        if (!e.repeat) cycleSubtitle()
      },
      ',': () => engine.runCommand(['frame-back-step']),
      '.': () => engine.runCommand(['frame-step']),
      d: (e) => {
        if (!e.repeat) engine.runCommand(['cycle', 'deinterlace'])
      },
      'shift+s': (e) => {
        if (!e.repeat) engine.runCommand(['screenshot'])
      },
      '?': () => setShortcutsOpen((v) => !v),
      'shift+?': () => setShortcutsOpen((v) => !v)
    },
    { ignoreFocusGuard: true }
  )

  // plain functions — useHotkeys reads through a ref, no stable identity needed
  function jumpChapter(dir: 1 | -1): void {
    const marks = (playing?.Chapters ?? []).map((c) => ticksToSeconds(c.StartPositionTicks))
    if (!marks.length) return
    const t = currentTime()
    const target =
      dir === 1 ? marks.find((m) => m > t + 1) : [...marks].reverse().find((m) => m < t - 3)
    if (target === undefined) {
      if (dir === -1) seek(0)
      return
    }
    seek(target)
    poke()
    showToast(dir === 1 ? 'Next chapter' : 'Previous chapter')
  }

  // keyboard-reachable equivalent of the audio/subtitle menus (base-ui popovers with tabIndex={-1}, controls are mouse/hotkey only, see useHotkeys.ts)
  function cycleAudio(): void {
    if (!session || session.audioStreams.length < 2) return
    const current = player.audioIndex ?? session.mediaSource.DefaultAudioStreamIndex
    const streams = session.audioStreams
    const i = streams.findIndex((s) => s.Index === current)
    const next = streams[(i + 1) % streams.length]
    player.selectAudio(next.Index)
    showToast(`Audio: ${next.DisplayTitle ?? `Track ${next.Index}`}`)
  }

  function cycleSubtitle(): void {
    if (!session || !session.subtitleStreams.length) return
    const streams = session.subtitleStreams
    const i = streams.findIndex((s) => s.Index === player.subtitleIndex)
    selectSubtitle(i + 1 >= streams.length ? null : streams[i + 1].Index)
  }

  function stepSpeed(dir: 1 | -1): void {
    const i = speeds.indexOf(engine.rate)
    const next =
      speeds[Math.max(0, Math.min(speeds.length - 1, (i < 0 ? speeds.indexOf(1) : i) + dir))]
    player.changeRate(next)
    showToast(`Speed ${next}×`)
  }

  // stable identities, same reason as callbacks above — feed memoized controls-bar props
  const playNextEpisode = useMemo(
    () => (nextEp ? () => void playItem(nextEp) : undefined),
    [nextEp, playItem]
  )

  const displayDuration = engine.duration || ticksToSeconds(session?.mediaSource.RunTimeTicks)
  // only notable quality/HDR/audio tags (issue #12) -- full breakdown (mediaBadges) is details-pages-only now
  const specialBadges = useMemo(
    () => playerSpecialBadges(session?.mediaSource.MediaStreams ?? []),
    [session]
  )

  return (
    <div
      className={styles.stage}
      onMouseMove={poke}
      onClick={() => {
        // controls hidden = click layer inert; don't eat the click
        if (!visible) {
          engine.togglePlay()
          poke()
        }
      }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement
        if (t === e.currentTarget || t === videoRef.current) toggleFullscreen()
      }}
      style={{ cursor: visible ? 'default' : 'none' }}
    >
      <div ref={videoRef} className={styles.video} />
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
      {!player.error && !session && (
        <div className={styles.loadingLayer}>
          <div className={styles.loadingSpinner} />
        </div>
      )}
      {!player.error && session && engine.pip && (
        <PipOverlay
          item={session.item}
          time={engine.time}
          duration={displayDuration}
          onBack={() => navigate({ to: '/' })}
          onEndPiP={engine.togglePiP}
        />
      )}
      {!player.error && session && !engine.pip && (
        <PlayerControls
          visible={visible}
          item={session.item}
          playMethod={session.playMethod}
          specialBadges={specialBadges}
          cpuFallback={engine.renderBackend() === 'cpu'}
          state={engine.state}
          time={engine.time}
          duration={displayDuration}
          bufferedEnd={engine.bufferedEnd}
          volume={engine.volume}
          muted={engine.muted}
          rate={engine.rate}
          pip={engine.pip}
          pipAvailable={engine.pipAvailable}
          fullscreen={fullscreen}
          audioStreams={session.audioStreams}
          subtitleStreams={session.subtitleStreams}
          audioIndex={player.audioIndex ?? session.mediaSource.DefaultAudioStreamIndex}
          subtitleIndex={player.subtitleIndex}
          subtitleDelay={player.subtitleDelay}
          subtitleDelayEnabled={player.subtitleIsText}
          nextEpisode={nextEp ?? undefined}
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
        />
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
