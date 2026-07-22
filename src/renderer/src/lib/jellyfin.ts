// Plain-fetch Jellyfin client. No SDK dep — the REST surface Photon needs is small.

export interface Session {
  server: string // normalized base URL, no trailing slash
  token: string
  userId: string
  userName: string
}

let session: Session | null = null

export function configure(s: Session | null): void {
  session = s
}

export function deviceId(): string {
  let id = localStorage.getItem('photon.deviceId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('photon.deviceId', id)
  }
  return id
}

// set once at startup from the real app version (main.tsx) — falls back to
// this if that IPC round trip hasn't resolved yet on the very first request
let clientVersion = '1.0.0'
export function setClientVersion(v: string): void {
  clientVersion = v
}

function authHeader(token?: string): string {
  const parts = [
    'MediaBrowser Client="Photon"',
    `Device="${encodeURIComponent(navigator.platform || 'Desktop')}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${clientVersion}"`
  ]
  if (token) parts.push(`Token="${token}"`)
  return parts.join(', ')
}

export class JellyfinError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

// a dropped/asleep server otherwise hangs on the OS TCP timeout (minutes)
// instead of the friendly "Cannot reach server" message showing up fast
const REQUEST_TIMEOUT_MS = 10_000

export async function jf<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean> } = {}
): Promise<T> {
  if (!session) throw new JellyfinError(0, 'Not signed in')
  const url = new URL(session.server + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: authHeader(session.token),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch {
    throw new JellyfinError(0, 'Cannot reach server.')
  }
  if (!res.ok) throw new JellyfinError(res.status, `${res.status} ${res.statusText}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function normalizeServer(input: string): string {
  let s = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s
}

async function fetchOrThrow(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new JellyfinError(0, 'Cannot reach server.')
  }
}

async function authSession(base: string, res: Response): Promise<Session> {
  let data: { AccessToken?: string; User?: { Id: string; Name: string } }
  try {
    data = await res.json()
  } catch {
    throw new JellyfinError(res.status, 'Sign in failed: server sent an unexpected response.')
  }
  if (!data.AccessToken || !data.User) {
    throw new JellyfinError(res.status, 'Sign in failed: unexpected response from server.')
  }
  return {
    server: base,
    token: data.AccessToken,
    userId: data.User.Id,
    userName: data.User.Name
  }
}

export async function authenticateByName(
  server: string,
  username: string,
  password: string
): Promise<Session> {
  const base = normalizeServer(server)
  const res = await fetchOrThrow(`${base}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ Username: username, Pw: password })
  })
  if (res.status === 401) throw new JellyfinError(401, 'Incorrect username or password.')
  if (!res.ok) throw new JellyfinError(res.status, `Sign in failed (${res.status}).`)
  return authSession(base, res)
}

// --- Quick Connect (code-based sign-in approved from another Jellyfin app) ---

export interface QuickConnectStart {
  secret: string
  code: string
}

export async function quickConnectInitiate(server: string): Promise<QuickConnectStart> {
  const base = normalizeServer(server)
  const res = await fetchOrThrow(`${base}/QuickConnect/Initiate`, {
    method: 'POST',
    headers: { Authorization: authHeader() }
  })
  if (res.status === 401) throw new JellyfinError(401, 'Quick Connect is disabled on this server.')
  if (!res.ok) throw new JellyfinError(res.status, `Quick Connect failed (${res.status}).`)
  const data = (await res.json()) as { Secret?: string; Code?: string }
  if (!data.Secret || !data.Code)
    throw new JellyfinError(res.status, 'Quick Connect failed: unexpected response from server.')
  return { secret: data.Secret, code: data.Code }
}

// polls whether the code has been approved in another session
export async function quickConnectAuthenticated(server: string, secret: string): Promise<boolean> {
  const base = normalizeServer(server)
  const res = await fetchOrThrow(
    `${base}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`
  )
  if (!res.ok) throw new JellyfinError(res.status, 'Quick Connect code expired. Try again.')
  return !!((await res.json()) as { Authenticated?: boolean }).Authenticated
}

export async function authenticateWithQuickConnect(
  server: string,
  secret: string
): Promise<Session> {
  const base = normalizeServer(server)
  const res = await fetchOrThrow(`${base}/Users/AuthenticateWithQuickConnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ Secret: secret })
  })
  if (!res.ok) throw new JellyfinError(res.status, `Sign in failed (${res.status}).`)
  return authSession(base, res)
}

// --- shared types (only the fields Photon reads) ---

export interface UserData {
  PlaybackPositionTicks?: number
  PlayedPercentage?: number
  Played?: boolean
  IsFavorite?: boolean
}

export interface MediaStream {
  Index: number
  Type: 'Video' | 'Audio' | 'Subtitle' | string
  Codec?: string
  Language?: string
  DisplayTitle?: string
  IsTextSubtitleStream?: boolean
  IsDefault?: boolean // container disposition flag — what the browser plays in direct play
  DeliveryMethod?: string
  DeliveryUrl?: string
  IsExternal?: boolean
  Width?: number
  Height?: number
  VideoRangeType?: string // SDR | HDR10 | HDR10Plus | HLG | DOVI…
  ChannelLayout?: string // '5.1', '7.1', 'stereo'
  Profile?: string // audio profile, e.g. 'Dolby TrueHD + Dolby Atmos'
}

// short capability badges for a media source (details pages): 4K · HEVC · HDR10 · Atmos · 5.1
export function mediaBadges(streams: MediaStream[]): string[] {
  const v = streams.find((s) => s.Type === 'Video')
  const a =
    streams.find((s) => s.Type === 'Audio' && s.IsDefault) ??
    streams.find((s) => s.Type === 'Audio')
  const out: string[] = []
  if (v?.Width)
    out.push(
      v.Width >= 3800
        ? '4K'
        : v.Width >= 2500
          ? '1440p'
          : v.Width >= 1900
            ? '1080p'
            : v.Width >= 1260
              ? '720p'
              : 'SD'
    )
  if (v?.Codec) out.push(v.Codec.toUpperCase())
  const range = v?.VideoRangeType
  if (range && range !== 'SDR')
    out.push(range.startsWith('DOVI') ? 'Dolby Vision' : range === 'HDR10Plus' ? 'HDR10+' : range)
  if (a?.Codec) out.push(a.Profile?.includes('Atmos') ? 'Atmos' : a.Codec.toUpperCase())
  if (a?.ChannelLayout) out.push(a.ChannelLayout)
  return out
}

// player-overlay-only badges (issue #12): only the notable attributes --
// 4K, HDR/HDR10+/Dolby Vision variants, and Dolby Atmos. Plain codec names,
// resolutions below 4K, and stereo/plain-surround layouts stay off the
// overlay so the normal case (1080p, standard codecs, direct play) doesn't
// clutter it -- the full breakdown (mediaBadges) still shows on the
// movie/show details pages, unchanged.
export function playerSpecialBadges(streams: MediaStream[]): string[] {
  const v = streams.find((s) => s.Type === 'Video')
  const a =
    streams.find((s) => s.Type === 'Audio' && s.IsDefault) ??
    streams.find((s) => s.Type === 'Audio')
  const out: string[] = []
  if (v?.Width && v.Width >= 3800) out.push('4K')
  const range = v?.VideoRangeType
  if (range && range !== 'SDR')
    out.push(range.startsWith('DOVI') ? 'Dolby Vision' : range === 'HDR10Plus' ? 'HDR10+' : range)
  if (a?.Profile?.includes('Atmos')) out.push('Atmos')
  return out
}

export interface MediaSource {
  Id: string
  Name?: string
  MediaStreams?: MediaStream[]
  TranscodingUrl?: string
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  RunTimeTicks?: number
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
}

export interface ChapterInfo {
  StartPositionTicks: number
  Name?: string
}

// Jellyfin 10.9+ trickplay (scrub thumbnails): tiles of thumbs per media source.
// Outer key = mediaSourceId, inner key = width variant.
export interface TrickplayInfo {
  Width: number
  Height: number
  TileWidth: number // thumbs per tile row
  TileHeight: number // thumb rows per tile
  ThumbnailCount: number
  Interval: number // ms between thumbs
}

export interface BaseItem {
  Id: string
  Name: string
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | string
  ProductionYear?: number
  DateCreated?: string
  RunTimeTicks?: number
  OfficialRating?: string
  CommunityRating?: number // 0-10 star score from the server's metadata provider
  CriticRating?: number // 0-100, Rotten Tomatoes %
  Overview?: string
  SeriesId?: string
  SeriesName?: string
  SeasonId?: string
  SeasonName?: string
  IndexNumber?: number
  ParentIndexNumber?: number
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  UserData?: UserData
  MediaSources?: MediaSource[]
  Chapters?: ChapterInfo[]
  Trickplay?: Record<string, Record<string, TrickplayInfo>>
}

// display title: episodes get their series/episode context
export function itemTitle(item: BaseItem): string {
  return item.Type === 'Episode'
    ? `${item.SeriesName} · S${item.ParentIndexNumber}E${item.IndexNumber} · ${item.Name}`
    : item.Name
}

export interface ItemsResult {
  Items: BaseItem[]
  TotalRecordCount: number
}

// Jellyfin 10.9+ /MediaSegments — server-detected intro/outro/recap ranges.
// Older servers 404 on this route; callers must treat that as "no segments".
export interface MediaSegment {
  ItemId: string
  Type: 'Unknown' | 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial'
  StartTicks: number
  EndTicks: number
}

export function imageUrl(
  item: Pick<BaseItem, 'Id' | 'ImageTags' | 'SeriesId' | 'Type'>,
  width = 360
): string | null {
  if (!session) return null
  // episodes without their own primary image fall back to the series poster
  if (item.ImageTags?.Primary)
    return `${session.server}/Items/${item.Id}/Images/Primary?fillWidth=${width}&quality=90&tag=${item.ImageTags.Primary}`
  if (item.Type === 'Episode' && item.SeriesId)
    return `${session.server}/Items/${item.SeriesId}/Images/Primary?fillWidth=${width}&quality=90`
  return null
}

export function backdropUrl(item: BaseItem, width = 1280): string | null {
  if (!session) return null
  if (item.BackdropImageTags?.length)
    return `${session.server}/Items/${item.Id}/Images/Backdrop/0?fillWidth=${width}&quality=90`
  return null
}

// which tile image holds the thumb for a timestamp, and its pixel offset within
export function trickplayTile(
  info: TrickplayInfo,
  seconds: number
): { tile: number; x: number; y: number } {
  const perTile = info.TileWidth * info.TileHeight
  const thumb = Math.max(
    0,
    Math.min(Math.floor((seconds * 1000) / info.Interval), info.ThumbnailCount - 1)
  )
  const inTile = thumb % perTile
  return {
    tile: Math.floor(thumb / perTile),
    x: (inTile % info.TileWidth) * info.Width,
    y: Math.floor(inTile / info.TileWidth) * info.Height
  }
}

export function trickplayUrl(
  itemId: string,
  width: number,
  tileIndex: number,
  mediaSourceId: string
): string | null {
  if (!session) return null
  return `${session.server}/Videos/${itemId}/Trickplay/${width}/${tileIndex}.jpg?mediaSourceId=${mediaSourceId}&api_key=${session.token}`
}

// untranscoded stream — used for direct play and for external players (mpv)
export function directStreamUrl(itemId: string, mediaSourceId: string): string {
  if (!session) throw new JellyfinError(0, 'Not signed in')
  return `${session.server}/Videos/${itemId}/stream?static=true&mediaSourceId=${mediaSourceId}&api_key=${session.token}`
}

export function serverUrl(): string {
  if (!session) throw new JellyfinError(0, 'Not signed in')
  return session.server
}

export function currentSession(): Session | null {
  return session
}

export const TICKS_PER_SECOND = 10_000_000

export function ticksToSeconds(ticks?: number): number {
  return (ticks ?? 0) / TICKS_PER_SECOND
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND)
}
