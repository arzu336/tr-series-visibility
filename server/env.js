import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// ESM import'ları modül gövdesinden ÖNCE değerlendirilir: index.js içindeki dotenv.config()
// çağrısı, db.js (APP_DB_PATH) ve services/netflixPipelineRunner.js (PYTHON_BIN) gibi
// modüller process.env'i okuduktan SONRA çalışıyordu. Bu dosya index.js'in İLK import'u
// olarak yüklenir; böylece .env her modülden önce hazırdır. Var olan ortam değişkenlerini
// ezmez (dotenv varsayılanı) — vitest'in APP_DB_PATH'i korunur.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })
