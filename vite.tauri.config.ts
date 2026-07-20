// Vite config for the renderer, hosted by the Tauri shell (issue #5).
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
