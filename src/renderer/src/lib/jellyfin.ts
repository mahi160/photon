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

function authHeader(token?: string): string {
  const parts = [
    'MediaBrowser Client="Photon"',
    `Device="${encodeURIComponent(navigator.platform || 'Desktop')}"`,
    `DeviceId="${deviceId()}"`,
    'Version="1.0.0"'
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

export async function jf<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean> } = {}
): Promise<T> {
  if (!session) throw new JellyfinError(0, 'Not signed in')
  const url = new URL(session.server + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v))
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: authHeader(session.token),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  })
  if (!res.ok) throw new JellyfinError(res.status, `${res.status} ${res.statusText}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function normalizeServer(input: string): string {
  let s = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s
}

export async function authenticateByName(
  server: string,
  username: string,
  password: string
): Promise<Session> {
  const base = normalizeServer(server)
  let res: Response
  try {
    res = await fetch(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({ Username: username, Pw: password })
    })
  } catch {
    throw new JellyfinError(0, 'Cannot reach server.')
  }
  if (res.status === 401) throw new JellyfinError(401, 'Incorrect username or password.')
  if (!res.ok) throw new JellyfinError(res.status, 'Sign in failed.')
  const data = await res.json()
  return {
    server: base,
    token: data.AccessToken,
    userId: data.User.Id,
    userName: data.User.Name
  }
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

export interface BaseItem {
  Id: string
  Name: string
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | string
  ProductionYear?: number
  RunTimeTicks?: number
  OfficialRating?: string
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
