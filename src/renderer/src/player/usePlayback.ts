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
import { useSubtitleSelection } from '../hooks/useSubtitleSelection'
import {
  reportProgress,
  reportStart,
  reportStopped,
  resolveSubtitleSelection,
  startPlayback,
  stopActiveEncoding,
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
  const { index: subtitleIndex, isText: subtitleIsText, select: selectSubtitleLogic } = useSubtitleSelection(session)

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
    currentTime: engineCurrentTime
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
        selectSubtitleLogic(sel.display)
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

  // play a different item in place (next-episode button, autoplay-next).
  // resets per-item track state — stream indexes don't carry across files.
  async function playItem(next: BaseItem): Promise<void> {
    loadedKey.current = `${next.Id}#${attempt}`
    setError(null)
    setAudioIndex(undefined)
    // on failure stay put — the error layer (with retry) is already showing
    if (await loadFor(next, { startSeconds: 0 })) {
      navigate({ to: '/player/$itemId', params: { itemId: next.Id }, search: {}, replace: true })
    }
  }

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

  // initial load once item arrives; the key guard makes re-runs no-ops.
  // `attempt` bumps on retry to force a reload of the same item.
  const [attempt, setAttempt] = useState(0)
  const loadedKey = useRef<string | null>(null)
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

  // progress reporting: every 10s + on any pause (button, hotkey, PiP, media keys)
  const { state: engineState, currentTime } = engine
  useEffect(() => {
    const id = setInterval(() => {
      const sess = sessionRef.current
      if (!sess) return
      reportProgress(sess, currentTime(), engineState === 'paused')
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
  }, [engineState, currentTime])

  // OS media keys / overlay buttons
  const { togglePlay: engineTogglePlay, seekBy: engineSeekBy } = engine
  useEffect(() => {
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => engineTogglePlay())
    ms.setActionHandler('pause', () => engineTogglePlay())
    ms.setActionHandler('seekbackward', () => engineSeekBy(-10))
    ms.setActionHandler('seekforward', () => engineSeekBy(10))
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward'] as MediaSessionAction[])
        ms.setActionHandler(a, null)
      ms.metadata = null
    }
  }, [engineTogglePlay, engineSeekBy])

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

  const prevState = useRef(engineState)
  useEffect(() => {
    const was = prevState.current
    prevState.current = engineState
    if (engineState === 'paused' && was === 'playing') {
      const sess = sessionRef.current
      if (sess) reportProgress(sess, currentTime(), true)
    }
  }, [engineState, currentTime])

  function selectSubtitle(index: number | null): void {
    const sess = sessionRef.current
    if (!sess) return
    const action = selectSubtitleLogic(index)
    if (action === 'reload') {
      void loadFor(sess.item, {
        startSeconds: engine.currentTime(),
        audioStreamIndex: audioIndex,
        subtitleStreamIndex: index ?? -1,
        mediaSourceId: sess.mediaSource.Id
      })
    } else if (action === 'setTextTrack') {
      engine.setTextTrack(index)
    }
    // else: 'disable' needs no engine action
  }

  function selectAudio(index: number): void {
    const sess = sessionRef.current
    if (!sess) return
    setAudioIndex(index)
    const language = sess.audioStreams.find((s) => s.Index === index)?.Language
    if (language) useSettings.getState().set({ preferredAudioLanguage: language })
    useTrackMemory.getState().remember(sess.item.Id, { audioStreamIndex: index })
    // HTML5 can't switch embedded audio tracks: reload stream with the new
    // index, keeping the current subtitle selection (text, burn-in, or off)
    void loadFor(sess.item, {
      startSeconds: engine.currentTime(),
      audioStreamIndex: index,
      subtitleStreamIndex: subtitleIndex ?? -1,
      mediaSourceId: sess.mediaSource.Id
    })
  }

  function changeDelay(seconds: number): void {
    engine.setSubtitleDelay(seconds)
    setSubtitleDelay(seconds)
    useSettings.getState().set({ lastSubtitleDelay: seconds })
  }

  function changeRate(rate: number): void {
    engine.changeRate(rate)
    const settings = useSettings.getState()
    if (settings.rememberSpeed) settings.set({ lastSpeed: rate })
  }

  function retry(): void {
    setError(null)
    engine.clearError()
    setAttempt((a) => a + 1)
  }

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
