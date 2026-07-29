export type SettingsSectionKey =
  'general' | 'appearance' | 'playback' | 'stats' | 'server' | 'advanced' | 'about'

// order = sidebar order. Stats sits next to Playback -- read-only usage record not a setting, but nesting under Advanced would bury an actually-used dashboard behind "diagnostics", so it gets own slot.
export const settingsSections: { key: SettingsSectionKey; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'playback', label: 'Playback' },
  { key: 'stats', label: 'Stats' },
  { key: 'server', label: 'Server' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'about', label: 'About' }
]
