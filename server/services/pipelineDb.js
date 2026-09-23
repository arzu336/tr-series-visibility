import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VARSAYILAN_YOL = path.join(__dirname, '..', '..', 'data-pipeline-python', 'data', 'pipeline.db')

function pipelineDbPath() {
  return process.env.PIPELINE_DB_PATH || VARSAYILAN_YOL
}

let pipelineDb = null

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
}

/**
 * pipeline.db henüz hiç oluşturulmamış olabilir (netflix_pipeline.py hiç çalıştırılmadıysa) —
 * bu durumda çağıran taraf çökmemeli, Netflix/resmi platform verisi dürüstçe "yok" sayılmalı.
 * Bu yüzden hata durumunda `false` (bulundu ama açılamadı) değil `null` benzeri bir sentinel
 * yerine doğrudan `null` döner ki `if (!conn) return ...` her yerde aynı şekilde çalışsın.
 */
export function getPipelineDb() {
  if (pipelineDb !== null) return pipelineDb || null
  try {
    pipelineDb = new DatabaseSync(pipelineDbPath(), { readOnly: true })
  } catch (err) {
    console.error('[pipelineDb] pipeline.db açılamadı (resmi platform verisi kullanılamayacak):', err.message)
    pipelineDb = false
  }
  return pipelineDb || null
}
