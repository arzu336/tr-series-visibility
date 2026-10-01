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
    // Bayrak SVG'leri (flag-icons) CSS'e gömülmesin: gömülünce dizi sayfası açılırken ~270 bayrağın hepsi
    // iner (~420 KB CSS). Ayrı dosya olunca tarayıcı yalnızca ekranda görünen bayrakları ister.
    assetsInlineLimit: (filePath) => (filePath.includes('flag-icons') ? false : undefined),
  },
  test: {
    fileParallelism: false,

    env: {
      APP_DB_PATH: 'server/data/test-app.db',
    },
    globalSetup: ['./vitest.globalSetup.js'],
  },
})
