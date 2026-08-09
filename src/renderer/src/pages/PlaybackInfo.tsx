import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useState } from 'react'
import type { MediaSource, MediaStream } from '../lib/jellyfin'
import type { PlaybackStats } from '../player/engine'
import styles from './PlaybackInfo.module.css'

function Row({ label, value }: { label: string; value?: string }): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}

function formatBytes(bytes?: number): string | undefined {
  if (!bytes) return undefined
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec >= 1024 ** 2
    ? `${(bytesPerSec / 1024 ** 2).toFixed(1)} MB/s`
    : `${(bytesPerSec / 1024).toFixed(0)} KB/s`
}

// hwdec-current reports the literal string "no" when nothing engaged -- reads better as "Software"
function formatHwdec(hwdec: string): string {
  return !hwdec || hwdec === 'no' ? 'Software' : hwdec
}

// server's DeliveryMethod values, reworded to match the domain glossary's Text/Burned-in Subtitle split
function formatDeliveryMethod(method?: string): string | undefined {
  switch (method) {
    case 'External':
      return 'Text (delay/styling supported)'
    case 'Embed':
      return 'Embedded (mpv-rendered)'
    case 'Encode':
      return 'Burned-in (server-rendered)'
    default:
      return method
  }
}

export interface PlaybackInfoOverlayProps {
  open: boolean
  onClose: () => void
  mediaSource: MediaSource
  audioStream?: MediaStream
  subtitleStream?: MediaStream
  playMethod: 'DirectPlay' | 'Transcode'
  // dynamic mpv-only fields (ADR-0011) -- polled while the panel is open, not part of the tick stream
  getStats: () => Promise<PlaybackStats>
}

// General/Video/Audio read straight off the MediaSource/MediaStream Jellyfin already gave Photon
// (ADR-0011) -- only holds because Photon always direct-plays (ADR-0008), so mpv demuxes this exact
// file. The one dynamic section (mpv) is a genuine round trip, polled every second while open.
export function PlaybackInfoOverlay({
  open,
  onClose,
  mediaSource,
  audioStream,
  subtitleStream,
  playMethod,
  getStats
}: PlaybackInfoOverlayProps): React.JSX.Element | null {
  const videoStream = mediaSource.MediaStreams?.find((s) => s.Type === 'Video')
  const [stats, setStats] = useState<PlaybackStats | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const poll = (): void => {
      void getStats().then((s) => {
        if (!cancelled) setStats(s)
      })
    }
    poll()
    const id = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
      setStats(null) // reset for next open, off the closing render instead of the opening effect
    }
  }, [open, getStats])

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.overlay} />
        <Dialog.Popup className={styles.card}>
          <h1 className={styles.title}>Playback Info</h1>

          <div className={styles.columns}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>General</h2>
              <div className={styles.list}>
                <Row
                  label="Play method"
                  value={playMethod === 'DirectPlay' ? 'Direct Play' : 'Transcode'}
                />
                <Row label="Container" value={mediaSource.Container?.toUpperCase()} />
                <Row label="File size" value={formatBytes(mediaSource.Size)} />
              </div>
            </section>

            {videoStream && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Video</h2>
                <div className={styles.list}>
                  <Row label="Codec" value={videoStream.Codec?.toUpperCase()} />
                  <Row
                    label="Resolution"
                    value={
                      videoStream.Width && videoStream.Height
                        ? `${videoStream.Width}×${videoStream.Height}`
                        : undefined
                    }
                  />
                  <Row
                    label="Frame rate"
                    value={
                      videoStream.RealFrameRate
                        ? `${videoStream.RealFrameRate.toFixed(3)} fps`
                        : undefined
                    }
                  />
                  <Row
                    label="HDR"
                    value={
                      videoStream.VideoRangeType && videoStream.VideoRangeType !== 'SDR'
                        ? videoStream.VideoRangeType
                        : undefined
                    }
                  />
                </div>
              </section>
            )}

            {audioStream && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Audio</h2>
                <div className={styles.list}>
                  <Row label="Codec" value={audioStream.Codec?.toUpperCase()} />
                  <Row label="Channel layout" value={audioStream.ChannelLayout} />
                </div>
              </section>
            )}

            {subtitleStream && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Subtitle</h2>
                <div className={styles.list}>
                  <Row label="Codec" value={subtitleStream.Codec?.toUpperCase()} />
                  <Row label="Language" value={subtitleStream.Language} />
                  <Row label="Delivery" value={formatDeliveryMethod(subtitleStream.DeliveryMethod)} />
                  <Row label="Forced" value={subtitleStream.IsForced ? 'Yes' : undefined} />
                </div>
              </section>
            )}

            {stats && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>mpv</h2>
                <div className={styles.list}>
                  <Row label="Hardware decoding" value={formatHwdec(stats.hwdecCurrent)} />
                  <Row
                    label="Dropped frames (decoder)"
                    value={String(stats.decoderDroppedFrames)}
                  />
                  <Row
                    label="Dropped frames (display)"
                    value={String(stats.displayDroppedFrames)}
                  />
                  <Row
                    label="Cache duration"
                    value={`${stats.demuxerCacheDuration.toFixed(1)} s`}
                  />
                  <Row label="Cache speed" value={formatSpeed(stats.cacheSpeed)} />
                  <Row
                    label="A/V sync"
                    value={`${stats.avSync >= 0 ? '+' : ''}${stats.avSync.toFixed(3)} s`}
                  />
                </div>
              </section>
            )}
          </div>

          <div className={styles.footer}>
            Press <kbd className={styles.key}>Esc</kbd> to close
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
