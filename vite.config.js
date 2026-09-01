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
    // Globe3D.jsx (Three.js + globe.gl) ZATEN src/App.jsx'te React.lazy() ile kod-bölünmüş ve
    // sadece kullanıcı 3D görünümü seçtiğinde (mapView === '3d') mount ediliyor — ana bundle'a hiç
    // girmiyor, kendi ayrı chunk'ında. Uyarı bunun EKSİK olduğu için değil, o tek chunk'ın kendi
    // içeriğinin (Three.js + globe.gl, ~1.9MB) Vite'ın varsayılan 500kb eşiğini geçmesinden
    // kaynaklanıyor — zaten en-geç-mümkün-anda, sadece talep üzerine yükleniyor, daha fazla
    // bölünmesinin (Three.js'in kendi iç modüllerini ayırmak) gerçek bir kullanıcı faydası yok,
    // sadece bu BEKLENEN/kabul edilmiş chunk için uyarıyı susturuyoruz — başka bir chunk beklenmedik
    // şekilde büyürse uyarı yine çalışır.
    chunkSizeWarningLimit: 2000,
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
