import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default function setup() {
  const testDbPath = process.env.APP_DB_PATH
  if (!testDbPath) return

  const gercekDb = path.join(__dirname, 'server', 'data', 'app.db')
  if (path.resolve(testDbPath) === path.resolve(gercekDb)) {
    throw new Error('APP_DB_PATH canlı app.db ile aynı — testler izole değil, koşu durduruldu.')
  }

  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  for (const ek of ['', '-wal', '-shm']) {
    fs.rmSync(`${testDbPath}${ek}`, { force: true })
  }
}
