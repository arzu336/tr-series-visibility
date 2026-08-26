import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// data-pipeline-python KENDİ ayrı SQLite dosyasını tutuyor (bkz. data-pipeline-python/db.py
// modül docstring'i: "Node.js uygulamasının server/data/app.db'sinden BİLEREK AYRI"). Burada
// SADECE OKUMA amaçlı bir bağlantı açılıyor — netflix_pipeline.py'nin yazdığı veriye Node
// tarafından erişmenin tek yolu bu. server/services/countryScoringEngine.js VE server/impact.js
// AYNI bağlantıyı paylaşır (iki ayrı DatabaseSync açmak yerine) — Python hiçbir zaman app.db'ye,
// Node hiçbir zaman pipeline.db'ye YAZMIYOR.
const PIPELINE_DB_PATH = path.join(__dirname, '..', '..', 'data-pipeline-python', 'data', 'pipeline.db')

let pipelineDb = null

/**
 * pipeline.db henüz hiç oluşturulmamış olabilir (netflix_pipeline.py hiç çalıştırılmadıysa) —
 * bu durumda çağıran taraf çökmemeli, Netflix/resmi platform verisi dürüstçe "yok" sayılmalı.
 * Bu yüzden hata durumunda `false` (bulundu ama açılamadı) değil `null` benzeri bir sentinel
 * yerine doğrudan `null` döner ki `if (!conn) return ...` her yerde aynı şekilde çalışsın.
 */
export function getPipelineDb() {
  if (pipelineDb !== null) return pipelineDb || null
  try {
    pipelineDb = new DatabaseSync(PIPELINE_DB_PATH, { readOnly: true })
  } catch (err) {
    console.error('[pipelineDb] pipeline.db açılamadı (resmi platform verisi kullanılamayacak):', err.message)
    pipelineDb = false
  }
  return pipelineDb || null
}
