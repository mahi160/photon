import { Fragment, useEffect } from 'react'
import styles from './Shortcuts.module.css'

function Keys({ keys, join = '+' }: { keys: string[]; join?: string }): React.JSX.Element {
  return (
    <div className={styles.keys}>
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span className={styles.plus}>{join}</span>}
          <kbd className={styles.key}>{k}</kbd>
        </Fragment>
      ))}
    </div>
  )
}

function Item({
  label,
  hint,
  keys,
  join
}: {
  label: string
  hint?: string
  keys: string[]
  join?: string
}): React.JSX.Element {
  return (
    <div className={styles.item}>
      <div>
        <div className={styles.label}>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      <Keys keys={keys} join={join} />
    </div>
  )
}

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'

export function ShortcutsOverlay({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h1 className={styles.title}>Keyboard shortcuts</h1>

        <div className={styles.columns}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Global</h2>
            <div className={styles.list}>
              <Item label="Search" keys={['/']} />
              <Item label="Search" keys={[mod, 'F']} />
              <Item label="This overlay" keys={['?']} />
              <Item label="Back / close" keys={['Esc']} />
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Player</h2>
            <div className={styles.list}>
              <Item label="Play / pause" keys={['Space']} />
              <Item label="Seek ±10s" keys={['←', '→']} join="/" />
              <Item label="Volume" keys={['↑', '↓']} join="/" />
              <Item label="Mute" keys={['M']} />
              <Item label="Fullscreen" keys={['F']} />
              <Item label="Picture in picture" keys={['P']} />
              <Item
                label="Nudge subtitle delay"
                hint="Text subtitles only"
                keys={['[', ']']}
                join="/"
              />
            </div>
          </section>
        </div>

        <div className={styles.footer}>
          Press <kbd className={styles.key}>Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
