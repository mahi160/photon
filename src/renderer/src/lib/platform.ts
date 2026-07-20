// True when running under the Tauri shell rather than Electron. Both still
// build/run this renderer during the replatform (issue #5 onward is
// additive) -- a few call sites (the player engine, its <video>/<div> host
// element) need to branch on this until ticket #10 removes the Electron
// path entirely.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
