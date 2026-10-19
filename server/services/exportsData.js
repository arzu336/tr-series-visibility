import * as XLSX from 'xlsx'
import db, { inTransaction } from '../db.js'
import { resolveIso2FromLabel } from './countryLookup.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Türkiye'nin ülke × sektör × ay ihracatı (2026-10-16): ihracatçı birliklerinin aylık "ülkelere göre sektörel ihracat"
// dosyası (1000 $, kayıt bazlı geçici rakam). Her dosya cari ayı ve geçen yılın aynı ayını verir; eski dosyadan yeniye
// doğru işlenir, yeni dosyadaki (revize) değer eskisini ezer. Ayda bir yeni dosya; geçmiş dosyalar çalıştırma başına
// sınırlı sayıda geriye doğru alınır (2016'dan bu yana ≈130 dosya). Serbest bölgeler ve belirlenemeyen ülkeler atlanır.

const BASE = 'https://tim.org.tr/files/downloads/rakamlar'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) gorunurluk-platformu/1.0'
const FETCH_TIMEOUT_MS = 60000
const GAP_MS = 1500
const BACKFILL_FROM = { year: 2016, month: 1 } // dosya geçen yılı da verdiği için seri 2015'ten başlar
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
export const SECTOR_TOTAL = 'TOPLAM'
export const COUNTRY_ALL = 'ALL' // Türkiye geneli (bütün ülkeler)

/** Dizilerle ilişkilendirilebilecek tüketim sektörleri (TİM sektör adları, birebir). */
export const RELATED_SECTORS = [
  'Hazırgiyim ve Konfeksiyon',
  'Tekstil ve Hammaddeleri',
  'Deri ve Deri Mamulleri',
  'Halı',
  'Mobilya, Kağıt ve Orman Ürünleri',
  'Mücevher',
  'Kuru Meyve ve Mamulleri',
  'Fındık ve Mamulleri',
  'Zeytin ve Zeytinyağı',
  'Meyve Sebze Mamulleri',
  'Su Ürünleri ve Hayvansal Mamuller',
  'Hububat, Bakliyat, Yağlı Tohumlar ve Mamulleri',
]

db.exec(`
  CREATE TABLE IF NOT EXISTS exports_monthly (
    iso2 TEXT NOT NULL,
    sector TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    usd REAL NOT NULL,
    source TEXT,
    PRIMARY KEY (iso2, sector, year, month)
  );
  CREATE INDEX IF NOT EXISTS idx_exports_monthly_sector ON exports_monthly (sector, year, month);
`)

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const put = db.prepare(
  `INSERT INTO exports_monthly (iso2, sector, year, month, usd, source) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(iso2, sector, year, month) DO UPDATE SET usd = excluded.usd, source = excluded.source`
)

// ---------------------------------------------------------------------------------------------- ülke adları

const fold = (s) =>
  String(s || '')
    .toLocaleLowerCase('tr')
    .replace(/ı|i̇/g, 'i')
    .replace(/[şğüöçâîû]/g, (c) => ({ ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' })[c])
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const FOLDED_INDEX = new Map(Object.entries(countryNames).map(([iso2, e]) => [fold(e.name), iso2]))

// Dosyalardaki ad → ISO-2 (2016–2026 arası görülen yazımlar). Serbest bölgeler ve KKTC listede yok: atlanır.
const ALIASES = {
  abd: 'US',
  'birlesik devletler': 'US',
  bae: 'AE',
  dubai: 'AE',
  abudabi: 'AE',
  'sarja sharjah': 'AE',
  sarja: 'AE',
  'rusya federasyonu': 'RU',
  'beyaz rusya': 'BY',
  ekvator: 'EC',
  kostarika: 'CR',
  kotdivuar: 'CI',
  dominik: 'DM',
  dominika: 'DM',
  'dominik cumhuriyeti': 'DO',
  bruney: 'BN',
  brunei: 'BN',
  'cabo verde': 'CV',
  'cape verde': 'CV',
  'filistin devleti': 'PS',
  'isgal alt filistin t': 'PS',
  'guney kibris rum yonetimi': 'CY',
  kongo: 'CG',
  'kongo e zaire': 'CD',
  'kongo dem c': 'CD',
  'kongo demokratik cumhuriyeti': 'CD',
  'komorlar birligi': 'KM',
  'komor adalari': 'KM',
  liechtenstein: 'LI',
  maldivler: 'MV',
  'maldiv adalari': 'MV',
  'marsal adalari': 'MH',
  'marshall adalari': 'MH',
  svaziland: 'SZ',
  zambia: 'ZM',
  'gine bissau': 'GW',
  'sao tome ve prinsipe': 'ST',
  'sao tome ve principe': 'ST',
  'st kitts ve nevis': 'KN',
  'st lucia': 'LC',
  'st vincent ve grenadines': 'VC',
  'st vincent ve grenad': 'VC',
  'dogu timur': 'TL',
  makao: 'MO',
  'cayman adalari': 'KY',
  'faroe adalari': 'FO',
  aruba: 'AW',
  grenada: 'GD',
  palau: 'PW',
  samoa: 'WS',
  'samoa bati samoa': 'WS',
  tonga: 'TO',
  nauru: 'NR',
  kiribati: 'KI',
  tuvalu: 'TV',
  mikronezya: 'FM',
  'cook adalari': 'CK',
  anguilla: 'AI',
  montserrat: 'MS',
  guam: 'GU',
  mayotte: 'YT',
  niue: 'NU',
  'turk ve caicos ad': 'TC',
  'turks ve caicos adas': 'TC',
  'britanya virjin ad': 'VG',
  'ingiliz virjin adala': 'VG',
  'abd virjin adalari': 'VI',
  'amerikan samoasi': 'AS',
  'kuzey mariana adalari': 'MP',
  'kuzey mariana adalar': 'MP',
  'vallis ve futuna': 'WF',
  'vallis ve futuna ada': 'WF',
  'guney kore cumhuriye': 'KR',
  'kuzey kore demokrati': 'KP',
  'guney afrika cumhuri': 'ZA',
  moldavya: 'MD',
  'yeni zelanda': 'NZ',
  venezuella: 'VE',
  venuatu: 'VU',
  mogolistan: 'MN',
  'orta afrika cumhuriy': 'CF',
  'papua yeni gine': 'PG',
  'tanzanya birles cum': 'TZ',
  tanzanya: 'TZ',
  'trinidad ve tobago': 'TT',
  'antigua ve bermuda': 'AG',
  'seysel adalari ve ba': 'SC',
  'yeni kalodenya ve ba': 'NC',
  'hollanda antilleri': 'AN',
  'curacao adasi': 'CW',
  'cebeli tarik': 'GI',
  'kanarya adalari': 'ES',
  buhutan: 'BT',
  bostvana: 'BW',
  cad: 'TD',
  cibuti: 'DJ',
  zimbabve: 'ZW',
  'myanmar burma': 'MM',
  myanmar: 'MM',
  'laos halk cum': 'LA',
  laos: 'LA',
  'iran islam cum': 'IR',
  'azerbaycan nahcivan': 'AZ',
  'vietnam kuzey': 'VN',
  'vietnam guney': 'VN',
  'belc ka luksemburg': 'BE',
  'st pierre ve miquelo': 'PM',
  'fransa guney bolgesi': 'TF',
  'fransiz guney toprak': 'TF',
  'gun georg ve sand ad': 'GS',
  'britanya hint okyanusu topraklari': 'IO',
  'bir dev minor outly': 'UM',
  'abd kucuk out adl': 'UM',
  guadeloupe: 'GP',
  zanzibar: 'TZ',
  'kuzey irlanda': 'GB',
  monaco: 'MC',
  'ingiliz hint oky top': 'IO',
}
const SKIP_RE =
  /serbest|serb\.|ser\.b|s\.b$|kktc|kuzey kıbrıs|belirlenemeyen|bilinmeyen|okyanusu$|çeçen|dağıstan|tataristan|^toplam$/i

/** Dosyadaki ülke adı → ISO-2; serbest bölge, bilinmeyen ve ülke olmayan satırlar null. */
export function resolveExportCountry(label) {
  const name = String(label || '').trim()
  if (!name || SKIP_RE.test(name)) return null
  return resolveIso2FromLabel(name) || ALIASES[fold(name)] || FOLDED_INDEX.get(fold(name)) || null
}

// ---------------------------------------------------------------------------------------------- dosya

export function fileUrl(year, month) {
  const mm = String(month).padStart(2, '0')
  if (year <= 2014) return [`${BASE}/${year}/${month}/sektor_ulke_${mm}_${year}.xls`]
  const slug = `${year}-${mm}-ulkelere-gore-sektorel-ihracat-rakamlari`
  return [`${BASE}/${year}/${month}/${slug}.xlsx`, `${BASE}/${year}/${month}/${slug}.xls`]
}

/**
 * Dosya → kayıtlar. Başlık: "30.09.2026 Konsolide…"; 3. satırda sütun grubu etiketleri ("1 - 30 EYLÜL" aylık,
 * "1 - 31 AĞUSTOS" önceki ay, "1 OCAK - …" kümülatif), 4. satırda yıllar. Aylık grubun iki yıl sütunu alınır
 * (geçen yıl aynı ay, cari ay). Değer 1000 $ → dolar. Dönen: { year, month, rows: [{iso2, sector, year, month, usd}], unresolved }.
 */
export function parseExportsFile(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames.find((n) => /SEKTOR_ULKE/i.test(n)) || wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })
  const title = String(rows[0]?.[0] || '')
  const dm = title.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!dm) throw new Error('dosya başlığında tarih yok')
  const month = Number(dm[2])
  const year = Number(dm[3])
  const headerIdx = rows.findIndex((r) => String(r?.[0] || '').trim() === 'SEKTÖR')
  if (headerIdx < 1) throw new Error('SEKTÖR başlık satırı yok')
  const labels = rows[headerIdx - 1] || []
  const years = rows[headerIdx]
  // Aylık grup: "1 - 30 EYLÜL" biçimli ilk etiket; iki yıl sütunu hemen ardından gelir.
  let col = -1
  for (let i = 2; i < labels.length; i++) {
    if (typeof labels[i] === 'string' && /^1\s*-\s*\d{1,2}\s+\S+$/.test(labels[i].trim())) {
      col = i
      break
    }
  }
  if (col < 0 || typeof years[col] !== 'number' || typeof years[col + 1] !== 'number')
    throw new Error('aylık sütun grubu bulunamadı')
  const prevYear = years[col]
  const curYear = years[col + 1]
  if (curYear !== year) throw new Error(`başlık yılı (${year}) ile sütun yılı (${curYear}) uyuşmuyor`)
  const out = []
  const unresolved = new Set()
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const sector = String(r?.[0] || '').trim()
    const label = String(r?.[1] || '').trim()
    if (!sector || !label) continue
    // Ülke sütunundaki "TOPLAM" sektörün Türkiye geneli toplamıdır (iso2 = ALL); ülke bazlı toplam aşağıda hesaplanır.
    const iso2 = label.toLocaleUpperCase('tr') === 'TOPLAM' ? COUNTRY_ALL : resolveExportCountry(label)
    if (!iso2) {
      if (!SKIP_RE.test(label)) unresolved.add(label)
      continue
    }
    const sec = sector.toLocaleUpperCase('tr') === 'TOPLAM' ? SECTOR_TOTAL : sector
    if (sec === SECTOR_TOTAL && iso2 !== COUNTRY_ALL) continue
    for (const [y, v] of [
      [prevYear, r[col]],
      [curYear, r[col + 1]],
    ]) {
      if (typeof v === 'number' && Number.isFinite(v))
        out.push({ iso2, sector: sec, year: y, month, usd: Math.round(v * 1000) })
    }
  }
  // Birden çok satır aynı ülkeye düşebilir (ör. emirlikler): toplanır. Ülke toplamı sektörlerin toplamıdır.
  const merged = new Map()
  const add = (r) => {
    const k = `${r.iso2}|${r.sector}|${r.year}|${r.month}`
    merged.set(k, merged.has(k) ? { ...r, usd: merged.get(k).usd + r.usd } : r)
  }
  for (const r of out) {
    add(r)
    if (r.iso2 !== COUNTRY_ALL) add({ ...r, sector: SECTOR_TOTAL })
  }
  return { year, month, rows: [...merged.values()], unresolved: [...unresolved] }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchFile(year, month, fetchFn) {
  for (const url of fileUrl(year, month)) {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) return { url, buffer: Buffer.from(await res.arrayBuffer()) }
    if (res.status !== 404) throw new Error(`HTTP ${res.status} ${url}`)
  }
  return null
}

/** Bir ayın dosyasını alır ve yazar; dosya yoksa false. */
export async function importExportsMonth(year, month, { fetchFn = fetch } = {}) {
  const file = await fetchFile(year, month, fetchFn)
  if (!file) return false
  const parsed = parseExportsFile(file.buffer)
  inTransaction(() => {
    for (const r of parsed.rows)
      put.run(r.iso2, r.sector, r.year, r.month, r.usd, `${year}-${String(month).padStart(2, '0')}`)
  })
  if (parsed.unresolved.length) console.warn('[exports] eşleşmeyen ülke adları:', parsed.unresolved.join(', '))
  return parsed.rows.length
}

const prevMonth = ({ year, month }) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 })
const ymKey = ({ year, month }) => year * 100 + month

let running = false

/**
 * Aylık senkron: en son alınan aydan sonraki aylar (yeni dosya çıkmışsa) + geriye doğru `backfillBudget` dosya.
 * Ayda bir dener (dosya ayın ilk günlerinde çıkar); zorlamak için force.
 */
export async function syncExportsIfNeeded({
  fetchFn = fetch,
  now = new Date(),
  force = false,
  backfillBudget = 12,
  gapMs = GAP_MS,
} = {}) {
  if (running) return null
  const last = Number(metaGet.get('exportsSyncAt')?.value || 0)
  if (!force && now.getTime() - last < MONTH_MS / 4) return null // haftada bir bakılır, yeni dosya yoksa hemen döner
  running = true
  const result = { files: 0, rows: 0, errors: [] }
  try {
    const latest = metaGet.get('exportsLatest')?.value // "YYYY-MM" en son alınan ay
    const cursor = prevMonth({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }) // geçen ay en yeni olası dosya
    // İleri: en son alınan aydan geçen aya kadar
    let next = latest ? nextMonth(parseYm(latest)) : cursor
    while (ymKey(next) <= ymKey(cursor)) {
      try {
        const n = await importExportsMonth(next.year, next.month, { fetchFn })
        if (n === false) break // henüz yayımlanmamış
        result.files++
        result.rows += n
        metaSet.run('exportsLatest', fmtYm(next))
      } catch (err) {
        result.errors.push(`${fmtYm(next)}: ${err.message}`)
        break
      }
      next = nextMonth(next)
      await sleep(gapMs)
    }
    // Geri: en eski alınan aydan BACKFILL_FROM'a doğru, bütçe kadar
    let oldest = metaGet.get('exportsOldest')?.value ? parseYm(metaGet.get('exportsOldest').value) : null
    if (!oldest && metaGet.get('exportsLatest')?.value) oldest = parseYm(metaGet.get('exportsLatest').value)
    for (let i = 0; i < backfillBudget && oldest && ymKey(prevMonth(oldest)) >= ymKey(BACKFILL_FROM); i++) {
      const target = prevMonth(oldest)
      try {
        const n = await importExportsMonth(target.year, target.month, { fetchFn })
        if (n !== false) {
          result.files++
          result.rows += n
        }
      } catch (err) {
        result.errors.push(`${fmtYm(target)}: ${err.message}`)
      }
      oldest = target
      metaSet.run('exportsOldest', fmtYm(oldest))
      await sleep(gapMs)
    }
    metaSet.run('exportsSyncAt', String(now.getTime()))
    console.log(`[exports] ${result.files} dosya, ${result.rows} satır, hata ${result.errors.length}`)
  } finally {
    running = false
  }
  return result
}

const parseYm = (s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) })
const fmtYm = ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`
const nextMonth = ({ year, month }) => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 })

// ---------------------------------------------------------------------------------------------- okuma

/** Ülkenin aylık toplam (ya da verilen sektör) ihracatı, tarih sırasıyla. */
export function getExportSeries(iso2, sector = SECTOR_TOTAL) {
  return db
    .prepare('SELECT year, month, usd FROM exports_monthly WHERE iso2 = ? AND sector = ? ORDER BY year, month')
    .all(String(iso2).toUpperCase(), sector)
}

/** Ülkenin son ayı için sektör sektör cari ve geçen yıl aynı ay değeri. */
export function getSectorYoy(iso2) {
  const code = String(iso2).toUpperCase()
  const last = db
    .prepare(
      'SELECT year, month FROM exports_monthly WHERE iso2 = ? AND sector = ? ORDER BY year DESC, month DESC LIMIT 1'
    )
    .get(code, SECTOR_TOTAL)
  if (!last) return null
  const rows = db
    .prepare(
      `SELECT a.sector, a.usd cur, b.usd prev FROM exports_monthly a
       LEFT JOIN exports_monthly b ON b.iso2 = a.iso2 AND b.sector = a.sector AND b.year = a.year - 1 AND b.month = a.month
       WHERE a.iso2 = ? AND a.year = ? AND a.month = ?`
    )
    .all(code, last.year, last.month)
  return { year: last.year, month: last.month, rows }
}

/** Ülkenin aylık ilişkili sektör ihracatı toplamı (dizilerle ilişkilendirilebilen sektörler). */
export function getRelatedSeries(iso2) {
  const marks = RELATED_SECTORS.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT year, month, SUM(usd) usd FROM exports_monthly WHERE iso2 = ? AND sector IN (${marks})
       GROUP BY year, month ORDER BY year, month`
    )
    .all(String(iso2).toUpperCase(), ...RELATED_SECTORS)
}

export function getExportIso2s() {
  return new Set(
    db
      .prepare('SELECT DISTINCT iso2 FROM exports_monthly')
      .all()
      .map((r) => r.iso2)
  )
}
