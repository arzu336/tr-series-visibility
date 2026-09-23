import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const argv = process.argv.slice(2)
const bayrak = (ad) => argv.includes(`--${ad}`)
const deger = (ad) => {
  const i = argv.indexOf(`--${ad}`)
  return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : undefined
}

const force = bayrak('force')
const limit = deger('limit')

const { resolveArticles, backfillPageviews } = await import('../services/wikipediaBackfill.js')

console.log('1/2 — Wikidata kimlikleri ve dil başına makale başlıkları çözülüyor...')
const asama1 = await resolveArticles({ force, limit })
console.log(
  `     ${asama1.cozulen} dizi çözüldü, ${asama1.makale} makale bulundu` +
    (asama1.wikidatasiz ? `, ${asama1.wikidatasiz} dizinin Wikidata kaydı yok` : '')
)

console.log('2/2 — aylık okunma serileri çekiliyor (2015-07 sonrası)...')
const asama2 = await backfillPageviews({
  force,
  limit: limit ? limit * 10 : undefined,
  onProgress: (n, toplam) => console.log(`     ${n}/${toplam}`),
})
console.log(
  `     ${asama2.cift} çift işlendi — ${asama2.veriliCift} veri verdi, ${asama2.bosCift} boş, ` +
    `${asama2.hatali} hata. ${asama2.yazilanSatir} aylık satır yazıldı.`
)
if (asama2.hataOrnekleri?.length) {
  console.log('     hata örnekleri:')
  for (const h of asama2.hataOrnekleri) console.log('       -', h)
}
