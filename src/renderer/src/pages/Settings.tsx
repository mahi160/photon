import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../stores/session'
import { useSettings } from '../stores/settings'

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-medium text-neutral-300">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-8">
      <div>
        <div className="text-sm text-neutral-200">{label}</div>
        {hint && <div className="text-xs text-neutral-500">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`block size-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  )
}

const select = 'rounded-lg bg-surface-2 px-3 py-1.5 text-sm outline-none'

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
    <div className="max-w-xl px-8 py-8">
      <h1 className="mb-8 text-xl font-semibold tracking-tight">Settings</h1>

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
        <Row label="Theme">
          <select
            className={select}
            value={settings.theme}
            onChange={(e) => settings.set({ theme: e.target.value as 'dark' | 'light' | 'system' })}
            aria-label="Theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </Row>
      </Section>

      <Section title="Playback">
        <Row label="Preferred quality" hint="Maximum streaming bitrate">
          <select
            className={select}
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
            className={`${select} w-24`}
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
            onChange={(e) => settings.set({ subtitleStyle: { ...s, fontSize: Number(e.target.value) } })}
            aria-label="Subtitle size"
          />
        </Row>
        <Row label="Color">
          <input
            type="color"
            value={s.color}
            onChange={(e) => settings.set({ subtitleStyle: { ...s, color: e.target.value } })}
            aria-label="Subtitle color"
          />
        </Row>
        <Row label="Background">
          <select
            className={select}
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
            onChange={(e) => settings.set({ subtitleStyle: { ...s, opacity: Number(e.target.value) } })}
            aria-label="Subtitle opacity"
          />
        </Row>
      </Section>

      <Section title="Server">
        <Row label={session?.server ?? ''} hint={`Signed in as ${session?.userName ?? ''}`}>
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-3"
              onClick={() => queryClient.invalidateQueries()}
            >
              Reconnect
            </button>
            <button
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-red-400 hover:bg-surface-3"
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
            className="text-sm text-accent hover:underline"
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
