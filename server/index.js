import { app } from './app.js'
import { startScheduler } from './scheduler.js'

startScheduler()

const port = process.env.PORT || 3001
process.on('unhandledRejection', (reason) => {
  console.error('[process] yakalanmamış promise reddi:', reason instanceof Error ? reason.message : reason)
})
process.on('uncaughtException', (err) => {
  // Yakalanmamış istisnadan sonra süreç tanımsız durumdadır (yarım kalmış SQLite işlemi, açık
  // dosya tanıtıcısı, kaybolmuş timer). Devam etmek yerine günlüğe yazıp çıkılır; yeniden başlatma
  // dıştaki denetleyicinin işi (geliştirmede nodemon, üretimde systemd/pm2 — bkz. README Dağıtım).
  console.error('[process] yakalanmamış istisna, süreç kapatılıyor:', err.stack || err.message)
  setTimeout(() => process.exit(1), 300).unref()
})

app.listen(port, () => {
  console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`)
})
