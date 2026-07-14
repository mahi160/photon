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
  resolveSubtitleSelection,
  startPlayback,
  stopActiveEncoding,
  subtitleSwitchRequiresReload,
  type PlaybackSession
} from './session'
import { usePlayerEngine, type PlayerEngineApi } from './usePlayerEngine'

// Jellyfin side of playback: session lifecycle, track selection, progress
// reporting and autoplay-next. Composes usePlayerEngine; the Player page only
// wires UI to this API. Settings are read imperatively (useSettings.getState())
// so callbacks never go stale.

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
  // series card was clicked: play next-up, falling back to the first episode
  const s = await jf<ItemsResult>('/Shows/NextUp', {
    query: { seriesId: item.Id, Limit: 1 }
  })
  if (s.Items[0]) return s.Items[0]
  const eps = await jf<ItemsResult>(`/Shows/${item.Id}/Episodes`, { query: { Limit: 1 } })
  if (eps.Items[0]) return eps.Items[0]
  throw new Error('Nothing to play.')
}

// What to request from the server on first load (exported for tests).
// Audio: explicit request, else preferred language, else English, else the
// container default (matching it keeps direct play possible), else first.
// Subtitle preference must be in the *initial* request: PGS/ASS need a server
// burn-in, which only happens when the index is sent up front — so a burn-in
// server default (defaultSubtitleIndex) must be requested explicitly too, not
// left for the server to "pick", or it silently never gets burned in.
// -1 keeps the server from burning in its own default when subs are off.
export function pickInitialTracks(
  streams: MediaStream[],
  settings: {
    preferredAudioLanguage?: string
    preferredSubtitleLanguage?: string
    subtitlesEnabled: boolean
  },
  params: StartParams,
  defaultSubtitleIndex?: number
): { audioStreamIndex?: number; subtitleStreamIndex?: number } {
  const audioStreams = streams.filter((s) => s.Type === 'Audio')
  const defaultAudio =
    audioStreams.find(
      (s) => !!settings.preferredAudioLanguage && s.Language === settings.preferredAudioLanguage
    ) ??
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
  videoRef: React.RefObject<HTMLVideoElement | null>,
  item: BaseItem | undefined,
  params: StartParams
): PlaybackApi {
  const navigate = useNavigate()

  const [session, setSession] = useState<PlaybackSession | null>(null)
  const sessionRef = useRef<PlaybackSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined)
  const [subtitleDelay, setSubtitleDelay] = useState(0)
  // display state only — persistence (settings/track memory) is a user-intent
  // side effect and lives exclusively in selectSubtitle below
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null)
  const subtitleIsText =
    subtitleIndex !== null && session !== null && isTextTrack(session, subtitleIndex)

  const initial = useSettings.getState()
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
        if (sess) {
          reportStopped(sess, pos)
          sessionRef.current = null // handled — loadFor must not re-report it
        }
        void handleEnded(sess?.item)
      },
      onBeforeDestroy: (pos) => {
        const sess = sessionRef.current
        if (sess) reportStopped(sess, pos)
      }
    }
  )

  // stable engine commands, so loadFor (and the initial-load effect) stay stable
  const {
    load: engineLoad,
    setTextTrack,
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
      // a new PlaySessionId replaces the old one (track switch, next episode):
      // close the old session first so the server stops its transcode/progress
      const prev = sessionRef.current
      if (prev) {
        sessionRef.current = null
        reportStopped(prev, engineCurrentTime())
        // Stopped only updates progress tracking, not the ffmpeg job itself —
        // without this the old encode keeps running and a track-switch reload
        // can still resolve against it (stale audio/subtitles). Must be
        // awaited: starting the new one while the old is still alive is
        // exactly the race this is meant to avoid.
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
          hls: sess.hls,
          startSeconds: sess.startSeconds,
          textTracks: sess.textTracks
        })
        reportStart(sess, sess.startSeconds)

        const sel = resolveSubtitleSelection(sess, opts.subtitleStreamIndex, settings)
        setSubtitleIndex(sel.display)
        if (sel.textTrack !== null) setTextTrack(sel.textTrack)

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
    [engineLoad, setTextTrack, engineSetDelay, engineCurrentTime]
  )

  // initial load once item arrives; the key guard makes re-runs no-ops.
  // `attempt` bumps on retry to force a reload of the same item. Declared
  // before playItem/handleEnded so their closures can read it.
  const [attempt, setAttempt] = useState(0)
  const loadedKey = useRef<string | null>(null)

  // play a different item in place (next-episode button, autoplay-next).
  // resets per-item track state — stream indexes don't carry across files.
  // Stable identity (react-query-cached `nextEpisode` data flows straight
  // into a menu button prop) so it doesn't force that menu to re-render
  // on every playback tick.
  const playItem = useCallback(
    async (next: BaseItem): Promise<void> => {
      loadedKey.current = `${next.Id}#${attempt}`
      setError(null)
      setAudioIndex(undefined)
      // on failure stay put — the error layer (with retry) is already showing
      if (await loadFor(next, { startSeconds: 0 })) {
        navigate({ to: '/player/$itemId', params: { itemId: next.Id }, search: {}, replace: true })
      }
    },
    [loadFor, navigate, attempt]
  )

  async function handleEnded(prev?: BaseItem): Promise<void> {
    if (useSettings.getState().autoplayNext && prev?.Type === 'Episode' && prev.SeriesId) {
      // ponytail: relies on the server having processed the Stopped report; if the
      // same episode comes back we bail to avoid a loop
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
        // remembered pick for this item wins over language prefs/server
        // default, but an explicit URL param (deep link) still wins over that
        const remembered = useTrackMemory.getState().byItem[playable.Id]
        // track picking only sees stream info if the playable item carries it
        // (movies/episodes fetched with MediaSources)
        const { audioStreamIndex, subtitleStreamIndex } = pickInitialTracks(
          playable.MediaSources?.[0]?.MediaStreams ?? [],
          useSettings.getState(),
          {
            audio: audio ?? remembered?.audioStreamIndex,
            sub: sub ?? remembered?.subtitleStreamIndex
          },
          playable.MediaSources?.[0]?.DefaultSubtitleStreamIndex
        )
        if (audioStreamIndex !== undefined) setAudioIndex(audioStreamIndex)
        return loadFor(playable, {
          startSeconds: start,
          audioStreamIndex,
          subtitleStreamIndex,
          mediaSourceId: playable.MediaSources?.[0]?.Id
        })
      })
      .catch((e) => {
        console.error('[playback] resolve failed', e)
        setError('Nothing to play.')
      })
  }, [item, start, audio, sub, attempt, loadFor])

  // one immediate report on the playing→paused edge (button, hotkey, PiP,
  // media keys); also keeps the ref the 10s interval below reads fresh
  const { state: engineState, currentTime } = engine
  const engineStateRef = useRef(engineState)
  useEffect(() => {
    const was = engineStateRef.current
    engineStateRef.current = engineState
    if (engineState === 'paused' && was === 'playing') {
      const sess = sessionRef.current
      if (sess) reportProgress(sess, currentTime(), true)
    }
  }, [engineState, currentTime])

  // progress reporting every 10s. Reads engine state via the ref so the
  // interval survives play/pause/buffer flaps — recreating it on each one
  // would reset the cadence and could starve reports on a stuttering stream.
  useEffect(() => {
    const id = setInterval(() => {
      const sess = sessionRef.current
      if (!sess) return
      const paused = engineStateRef.current === 'paused'
      reportProgress(sess, currentTime(), paused)
      // local watch stats — only time actually playing counts
      if (engineStateRef.current === 'playing')
        useWatchStats.getState().record(sess.item, 10, false)
      // keep the OS media overlay's progress bar roughly honest
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
  }, [currentTime])

  // OS media keys are registered by useMediaSession (Player page) — the
  // single owner of that surface; this hook only sets metadata/position

  // volume/mute survive across sessions; debounced — a slider drag is dozens of
  // changes and each settings.set() writes localStorage
  const { volume: engineVolume, muted: engineMuted } = engine
  useEffect(() => {
    const id = setTimeout(
      () => useSettings.getState().set({ lastVolume: engineVolume, lastMuted: engineMuted }),
      500
    )
    return () => clearTimeout(id)
  }, [engineVolume, engineMuted])

  // Track-switch actions below are wrapped in useCallback: they end up as
  // props on the player's track-select menus (base-ui popovers), and those
  // menus are memoized to skip the re-render every playback tick brings —
  // that memoization only holds if these callbacks keep a stable identity.
  const selectSubtitle = useCallback(
    (index: number | null): void => {
      const sess = sessionRef.current
      if (!sess) return
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
      if (subtitleSwitchRequiresReload(sess, subtitleIndex, index)) {
        // burn-in only exists in the transcoded pixels — entering or leaving
        // it needs a new stream (loadFor re-resolves subtitleIndex from it)
        void loadFor(sess.item, {
          startSeconds: engineCurrentTime(),
          audioStreamIndex: audioIndex,
          subtitleStreamIndex: index ?? -1,
          mediaSourceId: sess.mediaSource.Id
        })
      } else {
        setSubtitleIndex(index)
        setTextTrack(index) // null clears the showing track
      }
    },
    [subtitleIndex, loadFor, engineCurrentTime, audioIndex, setTextTrack]
  )

  const selectAudio = useCallback(
    (index: number): void => {
      const sess = sessionRef.current
      if (!sess) return
      setAudioIndex(index)
      const language = sess.audioStreams.find((s) => s.Index === index)?.Language
      if (language) useSettings.getState().set({ preferredAudioLanguage: language })
      useTrackMemory.getState().remember(sess.item.Id, { audioStreamIndex: index })
      // HTML5 can't switch embedded audio tracks: reload stream with the new
      // index, keeping the current subtitle selection (text, burn-in, or off)
      void loadFor(sess.item, {
        startSeconds: engineCurrentTime(),
        audioStreamIndex: index,
        subtitleStreamIndex: subtitleIndex ?? -1,
        mediaSourceId: sess.mediaSource.Id
      })
    },
    [loadFor, engineCurrentTime, subtitleIndex]
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
