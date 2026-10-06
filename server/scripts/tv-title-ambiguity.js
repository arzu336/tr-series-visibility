import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import '../env.js'

// Televizyon rehberi eşleşmesi için belirsiz başlıklar: dizilerimizin yabancı/İngilizce adlarından hangileri IMDb'de
// BAŞKA bir film ya da dizinin de adı ("The Agency", "The Promise")? Bu adlar otomatik eşleşmede kullanılmaz.
// Kaynak: data-pipeline-python/data altındaki IMDb veri setleri (title.basics, title.akas). Sonuç app.db'de
// tv_title_ambiguity tablosuna yazılır. IMDb veri setleri yenilendiğinde yeniden çalıştırılır:
//   node server/scripts/tv-title-ambiguity.js

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(__dirname, '..', '..', 'data-pipeline-python', 'data')
const TYPES = new Set(['movie', 'tvMovie', 'tvSeries', 'tvMiniSeries', 'tvShort', 'tvSpecial', 'short', 'video'])

const { default: db } = await import('../db.js')
const { getPipelineDb } = await import('../services/pipelineDb.js')
const { foldTitle } = await import('../services/localTitles.js')

const conn = getPipelineDb()
const own = new Set(
  conn
    .prepare('SELECT tconst FROM imdb_title_map')
    .all()
    .map((r) => r.tconst)
)
const keys = new Set(
  conn
    .prepare('SELECT l.title FROM imdb_localized_titles l JOIN imdb_title_map m ON m.tconst = l.tconst')
    .all()
    .map((r) => foldTitle(r.title))
    .filter((k) => k.length >= 4)
)
console.log(`${keys.size} yabancı ad, ${own.size} kendi dizimiz`)

async function* rows(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATA, file)).pipe(zlib.createGunzip()) })
  let first = true
  for await (const line of rl) {
    if (first) {
      first = false
      continue
    }
    yield line.split('\t')
  }
}

// 1) title.akas: anahtarla eşleşen başka başlıklar (aday; türü sonra kontrol edilir)
const akaHits = new Map() // tconst → Set(key)
for await (const [tconst, , title] of rows('title.akas.tsv.gz')) {
  if (own.has(tconst)) continue
  const k = foldTitle(title)
  if (!keys.has(k)) continue
  if (!akaHits.has(tconst)) akaHits.set(tconst, new Set())
  akaHits.get(tconst).add(k)
}
console.log(`title.akas: ${akaHits.size} aday başlık`)

// 2) title.basics: türü uygun (bölüm değil) adayların ve ana adı eşleşenlerin sayımı
const others = new Map() // key → başka başlık sayısı
const bump = (k) => others.set(k, (others.get(k) || 0) + 1)
for await (const [tconst, type, primary, original] of rows('title.basics.tsv.gz')) {
  if (own.has(tconst) || !TYPES.has(type)) continue
  const hit = new Set(akaHits.get(tconst) || [])
  for (const t of [primary, original]) {
    const k = foldTitle(t)
    if (keys.has(k)) hit.add(k)
  }
  for (const k of hit) bump(k)
}

db.exec('CREATE TABLE IF NOT EXISTS tv_title_ambiguity (fold_key TEXT PRIMARY KEY, others INTEGER NOT NULL)')
db.exec('DELETE FROM tv_title_ambiguity')
const ins = db.prepare('INSERT INTO tv_title_ambiguity (fold_key, others) VALUES (?, ?)')
for (const [k, n] of others) ins.run(k, n)
console.log(`${others.size} belirsiz ad yazıldı`)
process.exit(0)
