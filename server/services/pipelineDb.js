import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VARSAYILAN_YOL = path.join(__dirname, '..', '..', 'data-pipeline-python', 'data', 'pipeline.db')

// Açılamayan bir dosya için her çağrıda yeniden denemek log'u doldurur; ama başarısızlığı
// süreç ömrü boyunca cache'lemek de yanlıştı: haftalık Netflix senkronu pipeline.db'yi sunucu
// çalışırken OLUŞTURUYOR ve Node yeniden başlatılana kadar veriyi görmüyordu. Ara yol: dosya
// yoksa sessizce null (ilk seferde tek uyarı), dosya var ama açılamadıysa kısa bir geri çekilme.
const RETRY_BACKOFF_MS = 60 * 1000

export function pipelineDbPath() {
  return process.env.PIPELINE_DB_PATH || VARSAYILAN_YOL
}

let pipelineDb = null
let lastFailureAt = 0
let missingWarned = false

/** Testlerin yolu değiştirdikten sonra bağlantıyı tazeleyebilmesi için. */
export function resetPipelineDb() {
  if (pipelineDb) {
    try {
      pipelineDb.close()
    } catch {
      /* zaten kapalı olabilir */
    }
  }
  pipelineDb = null
  lastFailureAt = 0
  missingWarned = false
}

/**
 * Salt okunur pipeline.db bağlantısı; dosya yoksa veya açılamıyorsa null. Çağıran taraf
 * null'u "resmi platform verisi yok" olarak ele alır, çökmez. Dosya sonradan oluşursa bir
 * sonraki çağrıda otomatik açılır.
 */
export function getPipelineDb() {
  if (pipelineDb) return pipelineDb

  const yol = pipelineDbPath()
  if (!fs.existsSync(yol)) {
    if (!missingWarned) {
      console.warn(`[pipelineDb] ${yol} bulunamadı — Python hattı henüz çalışmamış olabilir; oluşunca otomatik açılır.`)
      missingWarned = true
    }
    return null
  }

  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_BACKOFF_MS) return null

  try {
    pipelineDb = new DatabaseSync(yol, { readOnly: true })
    lastFailureAt = 0
    missingWarned = false
    return pipelineDb
  } catch (err) {
    lastFailureAt = Date.now()
    console.error('[pipelineDb] pipeline.db açılamadı (resmi platform verisi kullanılamayacak):', err.message)
    return null
  }
}
