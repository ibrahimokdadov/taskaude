import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'web',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3737',
      // timeout: 0 required — SSE is a long-lived connection;
      // http-proxy's default socket timeout silently drops the stream in dev.
      '/events': { target: 'http://localhost:3737', changeOrigin: false, timeout: 0 },
    },
  },
})
