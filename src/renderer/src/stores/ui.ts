import { create } from 'zustand'

// transient cross-page UI state, not settings (nothing to persist) -- currently just shortcuts overlay, opened by AppLayout's '?' hotkey or Settings > About.
interface UiState {
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open })
}))
