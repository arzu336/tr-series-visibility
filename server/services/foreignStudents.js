import db, { inTransaction } from '../db.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Türkiye'de okuyan uluslararası öğrenciler, geldikleri ülkeye göre (yıllık). Kaynak: UNESCO İstatistik
// Enstitüsü açık API'si (anahtar gerekmez); Türkiye rakamlarını YÖK bildirir. YÖK'ün kendi istatistik
// sitesi JavaScript uygulaması olduğundan doğrudan okunamıyor — aynı resmî veri buradan alınır.
// Kültürel etki göstergesi: dizilerin güçlü olduğu ülkelerden Türkiye'de eğitim talebi.

const UIS = 'https://api.uis.unesco.org/api/public'
const TIMEOUT_MS = 60000
const FROM_YEAR = 2010
const BATCH = 40
export const SYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const META_KEY = 'lastForeignStudentsSyncAt'
const INDICATOR_RE = /^Inbound internationally mobile students from [^:]+: Students from (.+), both sexes \(number\)$/

// UNESCO adlandırmasının Node'un İngilizce ülke adlarından farklı olduğu durumlar (normalize edilmiş biçimde).
const UN_ALIASES = {
  'iran islamic republic of': 'IR',
  'islamic republic of iran': 'IR',
  'plurinational state of bolivia': 'BO',
  'bolivarian republic of venezuela': 'VE',
  'federated states of micronesia': 'FM',
  'hong kong special administrative region of china': 'HK',
  'macao special administrative region of china': 'MO',
  'republic of korea': 'KR',
  'democratic peoples republic of korea': 'KP',
  'russian federation': 'RU',
  'syrian arab republic': 'SY',
  'republic of moldova': 'MD',
  'united republic of tanzania': 'TZ',
  'bolivia plurinational state of': 'BO',
  'venezuela bolivarian republic of': 'VE',
  'viet nam': 'VN',
  'lao peoples democratic republic': 'LA',
  turkiye: 'TR',
  'republic of north macedonia': 'MK',
  'north macedonia': 'MK',
  'united kingdom of great britain and northern ireland': 'GB',
  'united states of america': 'US',
  'netherlands kingdom of the': 'NL',
  'micronesia federated states of': 'FM',
  palestine: 'PS',
  'state of palestine': 'PS',
  'brunei darussalam': 'BN',
  'cabo verde': 'CV',
  'cape verde': 'CV',
  congo: 'CG',
  'democratic republic of the congo': 'CD',
  'cote divoire': 'CI',
  'china hong kong special administrative region': 'HK',
  'china macao special administrative region': 'MO',
  czechia: 'CZ',
  eswatini: 'SZ',
  swaziland: 'SZ',
  'holy see': 'VA',
  'sao tome and principe': 'ST',
  'saint kitts and nevis': 'KN',
  'saint vincent and the grenadines': 'VC',
  'timor leste': 'TL',
  myanmar: 'MM',
  'the former yugoslav republic of macedonia': 'MK',
}

export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bst\.?\s/g, 'saint ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

let englishIndex = null
function englishToIso2() {
  if (englishIndex) return englishIndex
  const dn = new Intl.DisplayNames(['en'], { type: 'region' })
  englishIndex = new Map()
  for (const iso2 of Object.keys(countryNames)) {
    const n = dn.of(iso2)
    if (n && n !== iso2) englishIndex.set(normalizeName(n), iso2)
  }
  return englishIndex
}

/** UNESCO ülke adı → ISO2 (bilinmiyorsa null; uydurma eşleme yok). */
export function resolveUnCountry(name) {
  const n = normalizeName(name)
  return UN_ALIASES[n] ?? englishToIso2().get(n) ?? null
}

/** Gösterge tanımları → [{ code, iso2, origin }] (Türkiye'ye gelen, köken ülkeye göre). */
export function pickOriginIndicators(definitions) {
  const out = []
  const unresolved = []
  for (const d of definitions) {
    const m = INDICATOR_RE.exec(d.name || '')
    if (!m) continue
    const iso2 = resolveUnCountry(m[1])
    if (iso2) out.push({ code: d.indicatorCode, iso2, origin: m[1] })
    else unresolved.push(m[1])
  }
  return { indicators: out, unresolved }
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`UNESCO API isteği başarısız (${res.status})`)
  return res.json()
}

const upsertStmt = db.prepare(`
  INSERT INTO foreign_students (iso2, year, students, imported_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(iso2, year) DO UPDATE SET students = excluded.students, imported_at = excluded.imported_at
`)

export async function syncForeignStudents({ fetchImpl = fetch } = {}) {
  const definitions = await getJson(
    `${UIS}/definitions/indicators?theme=EDUCATION&disaggregations=false&glossaryTerms=false`,
    fetchImpl
  )
  const { indicators, unresolved } = pickOriginIndicators(definitions)
  const byCode = new Map(indicators.map((i) => [i.code, i.iso2]))
  const rows = []
  for (let i = 0; i < indicators.length; i += BATCH) {
    const q = new URLSearchParams([
      ['geoUnit', 'TUR'],
      ['start', String(FROM_YEAR)],
    ])
    for (const ind of indicators.slice(i, i + BATCH)) q.append('indicator', ind.code)
    const data = await getJson(`${UIS}/data/indicators?${q}`, fetchImpl)
    for (const r of data.records || []) {
      const iso2 = byCode.get(String(r.indicatorId))
      if (iso2 && Number.isFinite(r.value)) rows.push({ iso2, year: r.year, students: Math.round(r.value) })
    }
  }
  const now = new Date().toISOString()
  inTransaction(() => {
    for (const r of rows) upsertStmt.run(r.iso2, r.year, r.students, now)
  })
  if (unresolved.length) console.warn('[foreignStudents] eşleşmeyen köken ülke adları:', unresolved.join(', '))
  return { indicators: indicators.length, rows: rows.length, unresolved }
}

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

/** Aylık: UNESCO yılda birkaç kez yayımlar; 30 günde bir kontrol yeterli. */
export async function syncForeignStudentsIfNeeded({ now = Date.now(), sync = syncForeignStudents } = {}) {
  const last = Number(getMetaStmt.get(META_KEY)?.value || 0)
  if (now - last < SYNC_INTERVAL_MS) return null
  const result = await sync()
  setMetaStmt.run(META_KEY, String(now))
  console.log(`[foreignStudents] ${result.rows} kayıt (${result.indicators} köken ülke) eşitlendi`)
  return result
}

const seriesStmt = db.prepare('SELECT year, students FROM foreign_students WHERE iso2 = ? ORDER BY year')
const latestYearStmt = db.prepare('SELECT MAX(year) AS y FROM foreign_students')
const yearStmt = db.prepare('SELECT iso2, students FROM foreign_students WHERE year = ? ORDER BY students DESC')

/**
 * Bir ülkenin özeti: son yıl, öğrenci sayısı, 5 yıl önceye göre değişim, köken ülkeler arasındaki sırası.
 * Veri yoksa null.
 */
export function getForeignStudentSummary(iso2) {
  const series = seriesStmt.all(String(iso2).toUpperCase())
  if (!series.length) return null
  const last = series.at(-1)
  const base = series.find((r) => r.year === last.year - 5) ?? null
  const ranking = yearStmt.all(last.year)
  const rank = ranking.findIndex((r) => r.iso2 === String(iso2).toUpperCase()) + 1
  return {
    year: last.year,
    students: last.students,
    baseYear: base?.year ?? null,
    changePct: base?.students ? Math.round(((last.students - base.students) / base.students) * 1000) / 10 : null,
    rank: rank > 0 ? rank : null,
    of: ranking.length,
    series: series.map((r) => ({ year: r.year, students: r.students })),
  }
}

/** Son yılın en çok öğrenci gönderen ülkeleri (5 yıllık değişimle). */
export function getTopOriginCountries(limit = 10) {
  const y = latestYearStmt.get()?.y
  if (!y) return { year: null, items: [] }
  const base = new Map(yearStmt.all(y - 5).map((r) => [r.iso2, r.students]))
  const items = yearStmt
    .all(y)
    .slice(0, limit)
    .map((r) => ({
      iso2: r.iso2,
      students: r.students,
      changePct: base.get(r.iso2) ? Math.round(((r.students - base.get(r.iso2)) / base.get(r.iso2)) * 1000) / 10 : null,
    }))
  return { year: y, baseYear: y - 5, items }
}

const totalByYearStmt = db.prepare(
  'SELECT year, SUM(students) AS total FROM foreign_students GROUP BY year ORDER BY year'
)

/** Türkiye'deki toplam uluslararası öğrenci (son yıl) ve 5 yıl önceye göre değişim; veri yoksa null. */
export function getForeignStudentTotals() {
  const rows = totalByYearStmt.all()
  if (!rows.length) return null
  const last = rows.at(-1)
  const base = rows.find((r) => r.year === last.year - 5) ?? null
  return {
    year: last.year,
    total: last.total,
    baseYear: base?.year ?? null,
    changePct: base?.total ? Math.round(((last.total - base.total) / base.total) * 1000) / 10 : null,
  }
}
