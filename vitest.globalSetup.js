import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// globalSetup ana süreçte koşar; vite.config.js test.env yalnızca worker'lara uygulanır. Bu yüzden
// yol önce proje yapılandırmasından (project.config.env), yoksa ortamdan, o da yoksa aynı
// varsayılandan okunur — aksi halde test DB hiç silinmez ve önceki koşuların kullanıcıları kalır.
const VARSAYILAN_TEST_DB = 'server/data/test-app.db'

export default function setup(project) {
  const testDbPath = project?.config?.env?.APP_DB_PATH || process.env.APP_DB_PATH || VARSAYILAN_TEST_DB

  const gercekDb = path.join(__dirname, 'server', 'data', 'app.db')
  if (path.resolve(testDbPath) === path.resolve(gercekDb)) {
    throw new Error('APP_DB_PATH canlı app.db ile aynı — testler izole değil, koşu durduruldu.')
  }

  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  for (const ek of ['', '-wal', '-shm']) {
    fs.rmSync(`${testDbPath}${ek}`, { force: true })
  }
}
