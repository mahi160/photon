import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'
import { colorSchemes } from '../lib/colorSchemes'
import { resolvedDark } from '../lib/theme'
import styles from './Settings.module.css'

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}

function Row({
  label,
  children,
  hint
}: {
  label: string
  children: React.ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <div className={styles.row}>
      <div>
        <div className={styles.label}>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
    >
      <span className={styles.toggleThumb} />
    </button>
  )
}

const themeOptions: { key: 'dark' | 'light' | 'system'; label: string }[] = [
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'System' }
]

function ThemeSlabs(): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  return (
    <div className={styles.slabRow}>
      {themeOptions.map((o) => (
        <button
          key={o.key}
          className={`${styles.slab} ${theme === o.key ? styles.slabActive : ''}`}
          onClick={() => set({ theme: o.key })}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ColorSchemeSlabs(): React.JSX.Element {
  const scheme = useSettings((s) => s.colorScheme)
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  const themeAttr = resolvedDark(theme) ? 'dark' : 'light'
  return (
    <div className={styles.schemeGrid}>
      {colorSchemes.map((s) => (
        // data-scheme/data-theme on the slab itself: the tokens.css cascade
        // hands each slab its own scheme's variables — no duplicated palette data
        <button
          key={s.key}
          data-scheme={s.key}
          data-theme={themeAttr}
          className={`${styles.schemeSlab} ${scheme === s.key ? styles.schemeSlabActive : ''}`}
          style={{ background: 'var(--bg)', color: 'var(--fg)' }}
          onClick={() => set({ colorScheme: s.key })}
        >
          <span className={styles.schemeDots}>
            <i style={{ background: 'var(--accent)' }} />
            <i style={{ background: 'var(--accent-2)' }} />
            <i style={{ background: 'var(--accent-3)' }} />
            <i style={{ background: 'var(--accent-4)' }} />
          </span>
          <span className={styles.schemeLabel}>{s.label}</span>
        </button>
      ))}
    </div>
  )
}

// the persisted subtitle color must be a concrete hex (it feeds video::cue),
// so accent swatches resolve the active scheme's CSS variables at render time
function subtitleSwatches(): { label: string; value: string }[] {
  const root = getComputedStyle(document.documentElement)
  const accent = (name: string): string => root.getPropertyValue(name).trim()
  return [
    { label: 'White', value: '#ffffff' },
    { label: 'Yellow', value: '#f6e05e' },
    { label: 'Accent', value: accent('--accent') },
    { label: 'Accent 2', value: accent('--accent-2') },
    { label: 'Accent 3', value: accent('--accent-3') },
    { label: 'Accent 4', value: accent('--accent-4') }
  ]
}

function SubtitleColorSwatches({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  // subscribe so swatches re-resolve when scheme or theme changes
  useSettings((s) => s.colorScheme)
  useSettings((s) => s.theme)
  const swatches = subtitleSwatches()
  return (
    <div className={styles.swatchRow}>
      {swatches.map((sw) => (
        <button
          key={sw.label}
          aria-label={sw.label}
          title={sw.label}
          className={`${styles.swatch} ${value.toLowerCase() === sw.value.toLowerCase() ? styles.swatchActive : ''}`}
          style={{ background: sw.value }}
          onClick={() => onChange(sw.value)}
        />
      ))}
    </div>
  )
}

const playerModes = [
  { value: 'web', label: 'Built-in' },
  { value: 'auto', label: 'Built-in · mpv when transcoding' },
  { value: 'mpv', label: 'Always mpv' }
] as const

const bitrates = [
  { value: 0, label: 'Auto' },
  { value: 20_000_000, label: '20 Mbps' },
  { value: 10_000_000, label: '10 Mbps' },
  { value: 4_000_000, label: '4 Mbps' }
]

export function Settings(): React.JSX.Element {
  const settings = useSettings()
  const session = useSession((s) => s.session)
  const logout = useSession((s) => s.logout)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [version, setVersion] = useState('')
  const [loginItem, setLoginItem] = useState(false)
  const [hwAccel, setHwAccel] = useState(true)

  useEffect(() => {
    void window.api.appVersion().then(setVersion)
    void window.api.getLoginItem().then(setLoginItem)
    void window.api.getHwAccel().then(setHwAccel)
  }, [])

  const s = settings.subtitleStyle

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Settings</h1>

      <Section title="Appearance">
        <Row label="Theme">
          <ThemeSlabs />
        </Row>
        <Row label="Color scheme">
          <ColorSchemeSlabs />
        </Row>
      </Section>

      <Section title="General">
        <Row label="Launch at startup">
          <Toggle
            label="Launch at startup"
            checked={loginItem}
            onChange={(v) => {
              setLoginItem(v)
              void window.api.setLoginItem(v)
            }}
          />
        </Row>
      </Section>

      <Section title="Playback">
        <Row label="Preferred quality" hint="Maximum streaming bitrate">
          <select
            className={styles.select}
            value={settings.maxBitrate}
            onChange={(e) => settings.set({ maxBitrate: Number(e.target.value) })}
            aria-label="Preferred quality"
          >
            {bitrates.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Hardware acceleration" hint="Takes effect after restart">
          <Toggle
            label="Hardware acceleration"
            checked={hwAccel}
            onChange={(v) => {
              setHwAccel(v)
              void window.api.setHwAccel(v)
            }}
          />
        </Row>
        <Row label="Player" hint="mpv plays in its own window, avoids transcoding (requires mpv)">
          <select
            className={styles.select}
            value={settings.playerMode}
            onChange={(e) =>
              settings.set({ playerMode: e.target.value as (typeof playerModes)[number]['value'] })
            }
            aria-label="Player"
          >
            {playerModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Autoplay next episode">
          <Toggle
            label="Autoplay next episode"
            checked={settings.autoplayNext}
            onChange={(v) => settings.set({ autoplayNext: v })}
          />
        </Row>
        <Row label="Remember playback speed">
          <Toggle
            label="Remember playback speed"
            checked={settings.rememberSpeed}
            onChange={(v) => settings.set({ rememberSpeed: v })}
          />
        </Row>
      </Section>

      <Section title="Subtitles">
        <Row label="Enabled by default">
          <Toggle
            label="Subtitles enabled by default"
            checked={settings.subtitlesEnabled}
            onChange={(v) => settings.set({ subtitlesEnabled: v })}
          />
        </Row>
        <Row label="Preferred language" hint="ISO code, e.g. eng">
          <input
            className={`${styles.select} ${styles.textInput}`}
            value={settings.preferredSubtitleLanguage}
            onChange={(e) => settings.set({ preferredSubtitleLanguage: e.target.value })}
            aria-label="Preferred subtitle language"
          />
        </Row>
        <Row label="Size">
          <input
            type="range"
            min={50}
            max={200}
            step={10}
            value={s.fontSize}
            onChange={(e) =>
              settings.set({ subtitleStyle: { ...s, fontSize: Number(e.target.value) } })
            }
            className={styles.slider}
            aria-label="Subtitle size"
          />
        </Row>
        <Row label="Color">
          <SubtitleColorSwatches
            value={s.color}
            onChange={(color) => settings.set({ subtitleStyle: { ...s, color } })}
          />
        </Row>
        <Row label="Background">
          <select
            className={styles.select}
            value={s.background}
            onChange={(e) => settings.set({ subtitleStyle: { ...s, background: e.target.value } })}
            aria-label="Subtitle background"
          >
            <option value="transparent">None</option>
            <option value="rgba(0,0,0,0.5)">Half</option>
            <option value="rgba(0,0,0,0.9)">Solid</option>
          </select>
        </Row>
        <Row label="Outline">
          <Toggle
            label="Subtitle outline"
            checked={s.outline}
            onChange={(v) => settings.set({ subtitleStyle: { ...s, outline: v } })}
          />
        </Row>
        <Row label="Vertical position">
          <input
            type="range"
            min={0}
            max={30}
            step={2}
            value={s.verticalPosition}
            onChange={(e) =>
              settings.set({ subtitleStyle: { ...s, verticalPosition: Number(e.target.value) } })
            }
            className={styles.slider}
            aria-label="Subtitle vertical position"
          />
        </Row>
        <Row label="Opacity">
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.1}
            value={s.opacity}
            onChange={(e) =>
              settings.set({ subtitleStyle: { ...s, opacity: Number(e.target.value) } })
            }
            className={styles.slider}
            aria-label="Subtitle opacity"
          />
        </Row>
      </Section>

      <Section title="Server">
        <Row label={session?.server ?? ''} hint={`Signed in as ${session?.userName ?? ''}`}>
          <div className={styles.buttons}>
            <button className={styles.ghostBtn} onClick={() => queryClient.invalidateQueries()}>
              Reconnect
            </button>
            <button
              className={styles.dangerBtn}
              onClick={async () => {
                await logout()
                navigate({ to: '/login' })
              }}
            >
              Logout
            </button>
          </div>
        </Row>
      </Section>

      <Section title="About">
        <Row label={`Famto ${version}`} hint="MIT License">
          <a
            className={styles.link}
            href="https://github.com/famto/famto"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </Row>
      </Section>
    </div>
  )
}
