import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    fileParallelism: false,

    env: {
      APP_DB_PATH: 'server/data/test-app.db',
    },
    globalSetup: ['./vitest.globalSetup.js'],
  },
})
