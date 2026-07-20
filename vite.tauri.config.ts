// Dedicated Vite config for hosting the existing renderer under Tauri
// (issue #5). electron.vite.config.ts stays untouched — the Electron and
// Tauri shells build the same src/renderer source from two separate configs
// until issue #10 removes the Electron one.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve('dist-tauri'),
    emptyOutDir: true
  },
  server: {
    port: 1420,
    strictPort: true
  },
  clearScreen: false
})
