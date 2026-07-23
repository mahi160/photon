export type SettingsSectionKey =
  'general' | 'appearance' | 'playback' | 'stats' | 'server' | 'advanced' | 'about'

// order here is the sidebar order. Stats sits next to Playback -- it's a
// read-only record of how you've used it, not a setting, but it isn't the
// spec's six sections either; nesting it under Advanced would bury an
// existing, actually-used dashboard behind a "diagnostics" label, so it
// gets its own slot rather than get dropped.
export const settingsSections: { key: SettingsSectionKey; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'playback', label: 'Playback' },
  { key: 'stats', label: 'Stats' },
  { key: 'server', label: 'Server' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'about', label: 'About' }
]
