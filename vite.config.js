import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    // Test dosyaları (history/impact/destinations/trend) hepsi server/db.js'in tek bir
    // paylaşılan SQLite dosyasını (server/data/app.db) açıyor — vitest'in varsayılan
    // paralel dosya çalıştırması, her worker'ın aynı anda "PRAGMA journal_mode = WAL"
    // çalıştırmasına ve ara sıra "database is locked"/"disk I/O error" ile
    // çakışmasına yol açıyordu (kod hatası değil, node:sqlite + Windows dosya kilidi
    // yarışı). Dosyaları sıralı çalıştırmak bunu kalıcı olarak çözüyor.
    fileParallelism: false,
  },
})
