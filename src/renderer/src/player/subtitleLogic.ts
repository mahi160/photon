import { type MediaStream } from '../lib/jellyfin'

export type SubtitleDeliveryMethod = 'External' | 'Burned'

export interface SubtitleOption {
  index: number
  label: string
  language?: string
  delivery: SubtitleDeliveryMethod
}

export interface SubtitleSwitchAction {
  action: 'setTextTrack' | 'reload' | 'disable'
  streamIndex?: number
}

export function getSubtitleDelivery(stream: MediaStream): SubtitleDeliveryMethod {
  return stream.DeliveryMethod === 'External' ? 'External' : 'Burned'
}

export function analyzeSubtitleSwitch(
  current: SubtitleOption | null,
  next: SubtitleOption | null
): SubtitleSwitchAction {
  // turning off subtitles
  if (!next) return { action: 'disable' }

  // switching from burned-in to anything requires reload
  if (current?.delivery === 'Burned') return { action: 'reload', streamIndex: next.index }

  // switching to burned-in requires reload
  if (next.delivery === 'Burned') return { action: 'reload', streamIndex: next.index }

  // text-to-text switch: no reload needed
  return { action: 'setTextTrack' }
}

export function isTextTrack(stream: MediaStream): boolean {
  return stream.DeliveryMethod === 'External'
}
