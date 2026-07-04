import { Fragment } from 'react'
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

export function Shortcuts(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Keyboard Shortcuts</h1>
      <p className={styles.subtitle}>Famto is built to be used without touching the mouse.</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Global</h2>
        <div className={styles.list}>
          <Item label="Search" keys={[mod, 'F']} />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Player</h2>
        <div className={styles.list}>
          <Item label="Play / Pause" keys={['Space']} />
          <Item label="Seek back 10s" keys={['←']} />
          <Item label="Seek forward 10s" keys={['→']} />
          <Item label="Volume up" keys={['↑']} />
          <Item label="Volume down" keys={['↓']} />
          <Item label="Mute" keys={['M']} />
          <Item label="Fullscreen" keys={['F']} />
          <Item label="Exit fullscreen" keys={['Esc']} />
          <Item label="Picture in Picture" keys={['P']} />
          <Item
            label="Nudge subtitle delay"
            hint="Text subtitles only — disabled for burned-in tracks"
            keys={['[', ']']}
            join="/"
          />
        </div>
      </section>
    </div>
  )
}
