import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  jf,
  ticksToSeconds,
  type BaseItem,
  type ItemsResult,
  type MediaStream
} from '../lib/jellyfin'
import { useSettings } from '../stores/settings'
import { useTrackMemory } from '../stores/trackMemory'
import { useWatchStats } from '../stores/watchStats'
import {
  isTextTrack,
  reportProgress,
  reportStart,
  reportStopped,
  embeddedSubtitleSwitchNeedsReload,
  pickMediaSource,
  resolveSubtitleSelection,
  startPlayback,
  stopActiveEncoding,
  toDemuxedIndex,
  type PlaybackSession
} from './session'
import { usePlayerEngine, type PlayerEngineApi } from './usePlayerEngine'

// Jellyfin side of playback: session lifecycle, track selection, progress reporting, autoplay-next. Settings read imperatively (useSettings.getState()) so callbacks never go stale.

export interface StartParams {
  start?: number
  audio?: number
  sub?: number
}

export interface PlaybackApi {
  engine: PlayerEngineApi
  session: PlaybackSession | null
  error: string | null
  subtitleIndex: number | null
  audioIndex: number | undefined
  subtitleDelay: number
  subtitleIsText: boolean
  selectAudio: (index: number) => void
  selectSubtitle: (index: number | null) => void
  changeDelay: (seconds: number) => void
  changeRate: (rate: number) => void
  playItem: (item: BaseItem) => Promise<void>
  retry: () => void
}

export async function resolvePlayable(item: BaseItem): Promise<BaseItem> {
  if (item.Type !== 'Series') return item
  // series card clicked: play next-up, fall back to first episode
  const s = await jf<ItemsResult>('/Shows/NextUp', {
    query: { seriesId: item.Id, Limit: 1 }
  })
  if (s.Items[0]) return s.Items[0]
  const eps = await jf<ItemsResult>(`/Shows/${item.Id}/Episodes`, { query: { Limit: 1 } })
  if (eps.Items[0]) return eps.Items[0]
  throw new Error('Nothing to play.')
}

// Initial track request (exported for tests). Subtitle pref must be in the initial request so DefaultSubtitleStreamIndex reflects it; -1 stops server defaulting subs on when they're off.
export function pickInitialTracks(
  streams: MediaStream[],
  settings: {
    preferredAudioLanguage?: string
    preferredSubtitleLanguage?: string
    subtitlesEnabled: boolean
  },
  params: StartParams,
  defaultSubtitleIndex?: number,
  // server's own resolved default (MediaSource.DefaultAudioStreamIndex) -- also where Jellyfin's
  // per-user "remember audio selections" preference round-trips (see session.ts's reportBody comment).
  // Checked before the 'eng' guess below so a remembered/server pick outranks a blind language guess,
  // same priority the subtitle side of this function already gives defaultSubtitleIndex.
  defaultAudioIndex?: number
): { audioStreamIndex?: number; subtitleStreamIndex?: number } {
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const defaultAudio =
    audioStreams.find(
      (s) => !!settings.preferredAudioLanguage && s.Language === settings.preferredAudioLanguage
    ) ??
    audioStreams.find((s) => s.Index === defaultAudioIndex) ??
    audioStreams.find((s) => s.Language === 'eng') ??
    audioStreams.find((s) => s.IsDefault) ??
    audioStreams[0]
  let subtitleStreamIndex = params.sub
  if (subtitleStreamIndex === undefined) {
    subtitleStreamIndex = settings.subtitlesEnabled
      ? (streams.find(
          (s) =>
            s.Type === 'Subtitle' &&
            !!settings.preferredSubtitleLanguage &&
            s.Language === settings.preferredSubtitleLanguage
        )?.Index ?? defaultSubtitleIndex)
      : -1
  }
  return { audioStreamIndex: params.audio ?? defaultAudio?.Index, subtitleStreamIndex }
}

export function usePlayback(
  videoRef: React.RefObject<HTMLDivElement | null>,
  item: BaseItem | undefined,
  params: StartParams
): PlaybackApi {
  const navigate = useNavigate()

  const [session, setSession] = useState<PlaybackSession | null>(null)
  const sessionRef = useRef<PlaybackSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined)
  const [subtitleDelay, setSubtitleDelay] = useState(0)
  // display state only — persistence lives in selectSubtitle below
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  const subtitleIsText =
    subtitleIndex !== null && session !== null && isTextTrack(session, subtitleIndex)
  // mirrors let selectSubtitle/selectAudio no-op redundant re-selects (base-ui Select fires onValueChange on initial sync too) without needing state in their own dep arrays
  const subtitleIndexRef = useRef(subtitleIndex)
  const audioIndexRef = useRef(audioIndex)
  useEffect(() => {
    subtitleIndexRef.current = subtitleIndex
    audioIndexRef.current = audioIndex
  }, [subtitleIndex, audioIndex])

  const initial = useSettings.getState()
  // mirrors, same reason as subtitleIndexRef/audioIndexRef above -- report* calls read the engine's
  // current volume/mute without needing them in their own dependency arrays. Seeded from settings
  // (not the engine, which doesn't exist yet) -- the sync effect below overwrites these as soon as
  // the engine has its own first tick.
  const volumeRef = useRef(initial.lastVolume)
  const mutedRef = useRef(initial.lastMuted)

  // shared shape every reportStart/Progress/Stopped call (bar the initial load, which reports the
  // explicit request instead of these mirrors -- see loadFor) sends: current track picks + volume/mute,
  // so the dashboard's "Now Playing" panel and any client polling /Sessions sees a real value for both
  // instead of an indeterminate default (session.ts's reportBody maps these to VolumeLevel/IsMuted).
  const currentTracks = useCallback(
    () => ({
      audioStreamIndex: audioIndexRef.current,
      subtitleStreamIndex: subtitleIndexRef.current,
      volume: volumeRef.current,
      muted: mutedRef.current
    }),
    []
  )

  const engine = usePlayerEngine(
    videoRef,
    {
      rate: initial.rememberSpeed ? initial.lastSpeed : 1,
      volume: initial.lastVolume,
      muted: initial.lastMuted
    },
    {
      onEnded: (pos) => {
        const sess = sessionRef.current
        sessionRef.current = null // handled — loadFor must not re-report it
        void (async () => {
          // await the server actually processing "stopped" before asking it for NextUp -- otherwise NextUp
          // can still see this episode as in-progress and hand it right back (autoplay-next race)
          if (sess) await reportStopped(sess, pos, currentTracks())
          await handleEnded(sess?.item)
        })()
      },
      onBeforeDestroy: (pos) => {
        const sess = sessionRef.current
        if (sess) void reportStopped(sess, pos, currentTracks())
      }
    }
  )

  useEffect(() => {
    volumeRef.current = engine.volume
    mutedRef.current = engine.muted
  }, [engine.volume, engine.muted])

  // stable engine commands so loadFor (and the initial-load effect) stay stable
  const {
    load: engineLoad,
    setTextTrack,
    selectAudioTrack,
    selectEmbeddedSubtitleTrack,
    setSubtitleDelay: engineSetDelay,
    currentTime: engineCurrentTime,
    changeRate: engineChangeRate,
    clearError: engineClearError
  } = engine

  const loadFor = useCallback(
    async (
      playable: BaseItem,
      opts: {
        startSeconds?: number
        audioStreamIndex?: number
        subtitleStreamIndex?: number
        mediaSourceId?: string
      }
    ): Promise<boolean> => {
      const settings = useSettings.getState()
      // new PlaySessionId replaces old one (track switch, next episode): close old session first so server stops transcode/progress
      const prev = sessionRef.current
      if (prev) {
        sessionRef.current = null
        // Not awaited here -- reportStart below queues after it regardless (session.ts's shared FIFO report
        // queue), so the server still sees stop-then-start in order without stalling this reload on it.
        void reportStopped(prev, engineCurrentTime(), currentTracks())
        // Stopped only updates progress tracking, not the ffmpeg job — must await, or new session can race the still-running old encode
        if (prev.playMethod === 'Transcode') await stopActiveEncoding(prev)
      }
      try {
        const sess = await startPlayback(playable, {
          ...opts,
          maxBitrate: settings.maxBitrate || undefined
        })
        sessionRef.current = sess
        setSession(sess)
        await engineLoad({
          url: sess.url,
          startSeconds: sess.startSeconds,
          textTracks: sess.textTracks
        })
        // best-effort: opts' indices are only the explicit request for *this* load -- a no-override play
        // (autoplay-next, first open) leaves these undefined until the settings/server-default resolution
        // below picks a concrete index, which the next progress tick (<=10s, or the pause-edge report) carries.
        void reportStart(sess, sess.startSeconds, {
          audioStreamIndex: opts.audioStreamIndex,
          subtitleStreamIndex: opts.subtitleStreamIndex,
          volume: volumeRef.current,
          muted: mutedRef.current
        })

        // toDemuxedIndex/selectAudioTrack/selectEmbeddedSubtitleTrack resolve against mpv's own track-list — only meaningful under direct play (ADR-0008); Transcode fallback keeps whatever PlaybackInfo negotiated
        const directPlay = sess.playMethod === 'DirectPlay'

        if (directPlay && opts.audioStreamIndex !== undefined)
          selectAudioTrack(toDemuxedIndex(sess, opts.audioStreamIndex))

        const sel = resolveSubtitleSelection(sess, opts.subtitleStreamIndex, settings)
        setSubtitleIndex(sel.display)
        if (sel.textTrack !== null) setTextTrack(sel.textTrack)
        else if (directPlay && sel.embeddedTrack !== null)
          selectEmbeddedSubtitleTrack(toDemuxedIndex(sess, sel.embeddedTrack))
        // mpv auto-selects container's default subtitle track on load — explicitly turn off rather than let it override "subtitles off". Transcode fallback: same directPlay guard as the branch above -- mpv has no embedded track of its own to deselect there, this would be a no-op IPC round trip.
        else if (directPlay && sel.embeddedTrack === null) selectEmbeddedSubtitleTrack(null)

        // restore last subtitle sync offset, text tracks only
        const delay = sel.textTrack !== null ? settings.lastSubtitleDelay : 0
        if (delay) engineSetDelay(delay)
        setSubtitleDelay(delay)

        navigator.mediaSession.metadata = new MediaMetadata({
          title: playable.Name,
          artist: playable.SeriesName ?? ''
        })
        return true
      } catch (e) {
        console.error('[playback] load failed', e)
        setError('Playback failed.')
        return false
      }
    },
    [
      engineLoad,
      setTextTrack,
      selectAudioTrack,
      selectEmbeddedSubtitleTrack,
      engineSetDelay,
      engineCurrentTime,
      currentTracks
    ]
  )

  // initial load once item arrives, key guard makes re-runs no-ops. `attempt` bumps on retry to force reload of same item.
  const [attempt, setAttempt] = useState(0)
  const loadedKey = useRef<string | null>(null)

  // play different item in place (next-episode button, autoplay-next). resets per-item track state. Stable identity so cached nextEpisode data doesn't force menu re-render.
  const playItem = useCallback(
    async (next: BaseItem): Promise<void> => {
      loadedKey.current = `${next.Id}#${attempt}`
      setError(null)
      setAudioIndex(undefined)
      // on failure stay put — error layer (with retry) already showing
      if (await loadFor(next, { startSeconds: 0 })) {
        navigate({ to: '/player/$itemId', params: { itemId: next.Id }, search: {}, replace: true })
      }
    },
    [loadFor, navigate, attempt]
  )

  async function handleEnded(prev?: BaseItem): Promise<void> {
    if (useSettings.getState().autoplayNext && prev?.Type === 'Episode' && prev.SeriesId) {
      // ponytail: relies on server having processed Stopped report; bail if same episode comes back to avoid a loop
      const next = await jf<ItemsResult>('/Shows/NextUp', {
        query: { seriesId: prev.SeriesId, Limit: 1 }
      })
        .then((r) => r.Items[0] ?? null)
        .catch(() => null)
      if (next && next.Id !== prev.Id) {
        await playItem(next)
        return
      }
    }
    navigate({ to: '/' })
  }

  const { start, audio, sub } = params
  useEffect(() => {
    if (!item || loadedKey.current === `${item.Id}#${attempt}`) return
    loadedKey.current = `${item.Id}#${attempt}`
    setError(null)
    resolvePlayable(item)
      .then((playable) => {
        // remembered pick wins over language prefs/server default; explicit URL param (deep link) wins over that
        const remembered = useTrackMemory.getState().byItem[playable.Id]
        // track picking only sees stream info if playable item carries it (movies/episodes fetched with MediaSources)
        const source = pickMediaSource(playable.MediaSources ?? [])
        const { audioStreamIndex, subtitleStreamIndex } = pickInitialTracks(
          source?.MediaStreams ?? [],
          useSettings.getState(),
          {
            audio: audio ?? remembered?.audioStreamIndex,
            sub: sub ?? remembered?.subtitleStreamIndex
          },
          source?.DefaultSubtitleStreamIndex,
          source?.DefaultAudioStreamIndex
        )
        if (audioStreamIndex !== undefined) setAudioIndex(audioStreamIndex)
        return loadFor(playable, {
          startSeconds: start,
          audioStreamIndex,
          subtitleStreamIndex,
          mediaSourceId: source?.Id
        })
      })
      .catch((e) => {
        console.error('[playback] resolve failed', e)
        setError('Nothing to play.')
      })
  }, [item, start, audio, sub, attempt, loadFor])

  // one immediate report on playing→paused edge (button, hotkey, PiP, media keys); also keeps ref the 10s interval below reads fresh
  const { state: engineState, currentTime } = engine
  const engineStateRef = useRef(engineState)
  useEffect(() => {
    const was = engineStateRef.current
    engineStateRef.current = engineState
    // tell OS the real state so its overlay button is correct — play/pause both map to togglePlay otherwise
    navigator.mediaSession.playbackState = engineState === 'paused' ? 'paused' : 'playing'
    if (engineState === 'paused' && was === 'playing') {
      const sess = sessionRef.current
      if (sess) void reportProgress(sess, currentTime(), true, currentTracks())
    }
  }, [engineState, currentTime, currentTracks])

  // progress reporting every 10s. Reads engine state via ref so interval survives play/pause/buffer flaps without resetting cadence.
  useEffect(() => {
    const id = setInterval(() => {
      const sess = sessionRef.current
      if (!sess) return
      const paused = engineStateRef.current === 'paused'
      void reportProgress(sess, currentTime(), paused, currentTracks())
      // local watch stats — only actually-playing time counts
      if (engineStateRef.current === 'playing') useWatchStats.getState().record(sess.item, 10)
      // keep OS media overlay's progress bar roughly honest
      const dur = ticksToSeconds(sess.mediaSource.RunTimeTicks)
      if (dur > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: dur,
            position: Math.min(currentTime(), dur)
          })
        } catch {
          /* stale metadata can make position > duration — not worth surfacing */
        }
      }
    }, 10_000)
    return () => clearInterval(id)
  }, [currentTime, currentTracks])

  // OS media keys registered by useMediaSession (Player page); this hook only sets metadata/position

  // volume/mute survive across sessions; debounced — slider drag is dozens of changes, each settings.set() writes localStorage
  const { volume: engineVolume, muted: engineMuted } = engine
  useEffect(() => {
    const id = setTimeout(
      () => useSettings.getState().set({ lastVolume: engineVolume, lastMuted: engineMuted }),
      500
    )
    return () => clearTimeout(id)
  }, [engineVolume, engineMuted])

  // Track-switch actions wrapped in useCallback: feed memoized track-select menus, must keep stable identity
  const selectSubtitle = useCallback(
    (index: number | null): void => {
      const sess = sessionRef.current
      if (!sess || index === subtitleIndexRef.current) return
      // persist user intent — only here, never on mechanical loads
      if (index === null) {
        useSettings.getState().set({ subtitlesEnabled: false })
        useTrackMemory.getState().remember(sess.item.Id, { subtitleStreamIndex: -1 })
      } else {
        const language = sess.subtitleStreams.find((s) => s.Index === index)?.Language
        useSettings.getState().set({
          subtitlesEnabled: true,
          ...(language ? { preferredSubtitleLanguage: language } : {})
        })
        useTrackMemory.getState().remember(sess.item.Id, { subtitleStreamIndex: index })
      }
      // Transcode fallback only: non-text pick either side is/was burned into pixels, only fresh negotiation changes it (direct play never hits this)
      if (embeddedSubtitleSwitchNeedsReload(sess, subtitleIndexRef.current, index)) {
        void loadFor(sess.item, {
          startSeconds: engineCurrentTime(),
          audioStreamIndex: audioIndexRef.current,
          subtitleStreamIndex: index ?? -1,
          mediaSourceId: sess.mediaSource.Id
        })
        return
      }
      setSubtitleIndex(index)
      // direct play (ADR-0008) — mpv selects any embedded track, no reload needed. setTextTrack/selectEmbeddedSubtitleTrack both set mpv's one "sid" property — exactly one must fire per switch, never both (second call always wins)
      if (index !== null && isTextTrack(sess, index)) {
        setTextTrack(index)
      } else {
        selectEmbeddedSubtitleTrack(index === null ? null : toDemuxedIndex(sess, index))
      }
    },
    [setTextTrack, selectEmbeddedSubtitleTrack, loadFor, engineCurrentTime]
  )

  const selectAudio = useCallback(
    (index: number): void => {
      const sess = sessionRef.current
      if (!sess || index === audioIndexRef.current) return
      setAudioIndex(index)
      const language = sess.audioStreams.find((s) => s.Index === index)?.Language
      if (language) useSettings.getState().set({ preferredAudioLanguage: language })
      useTrackMemory.getState().remember(sess.item.Id, { audioStreamIndex: index })
      // Transcode fallback: output carries only the one audio track server negotiated -- switching needs a fresh transcode
      if (sess.playMethod !== 'DirectPlay') {
        void loadFor(sess.item, {
          startSeconds: engineCurrentTime(),
          audioStreamIndex: index,
          subtitleStreamIndex: subtitleIndexRef.current ?? -1,
          mediaSourceId: sess.mediaSource.Id
        })
        return
      }
      // direct play (ADR-0008) — mpv switches embedded audio track instantly, no reload/re-buffer needed
      selectAudioTrack(toDemuxedIndex(sess, index))
    },
    [selectAudioTrack, loadFor, engineCurrentTime]
  )

  const changeDelay = useCallback(
    (seconds: number): void => {
      engineSetDelay(seconds)
      setSubtitleDelay(seconds)
      useSettings.getState().set({ lastSubtitleDelay: seconds })
    },
    [engineSetDelay]
  )

  const changeRate = useCallback(
    (rate: number): void => {
      engineChangeRate(rate)
      const settings = useSettings.getState()
      if (settings.rememberSpeed) settings.set({ lastSpeed: rate })
    },
    [engineChangeRate]
  )

  const retry = useCallback((): void => {
    setError(null)
    engineClearError()
    setAttempt((a) => a + 1)
  }, [engineClearError, setAttempt])

  return {
    engine,
    session,
    error: error ?? engine.error,
    subtitleIndex,
    audioIndex,
    subtitleDelay,
    subtitleIsText,
    selectAudio,
    selectSubtitle,
    changeDelay,
    changeRate,
    playItem,
    retry
  }
}
