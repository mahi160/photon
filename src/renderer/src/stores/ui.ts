import { create } from 'zustand'

// transient cross-page UI state that doesn't belong in settings (not a
// preference, nothing to persist) -- currently just the shortcuts overlay,
// openable from both AppLayout's '?' hotkey and Settings > About.
interface UiState {
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open })
}))
