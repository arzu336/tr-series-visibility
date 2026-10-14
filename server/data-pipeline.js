import { getRawSeriesData, CAST_SOURCE, CATALOG_FILTER } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { ensureClassified, getThemeStore } from './themes.js'
import { ensureDetected, getDestinationStore } from './destinations.js'
import { buildVisibility, mergeProxyFallback, addLimitedCountries, attachPerCapitaScores } from './aggregate.js'
import { getCountryDemographics } from './services/countryDemographics.js'
import { getTrend, maybeRecordSnapshot, loadHistoryStore } from './history.js'
import { getFallbackInterestScores } from './services/proxyScore.js'
import { maybeRecordSeriesSnapshot } from './series-period-history.js'
import { getCatalogSupplementIds } from './services/pipelineData.js'
import tabiiCountries from '../src/data/tabii-countries.json' with { type: 'json' }
import { TABII_CACHE_KEY } from './services/tabiiCatalog.js'
import { recordAvailability } from './services/historyStore.js'

const RAW_CACHE_KEY = 'raw-series-providers'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000

let rawFetchInFlight = null

/** Önbellekteki katalog, güncel katalog tamamlama listesiyle mi kurulmuş? Değiştiyse katalog yeniden kurulur. */
export function sameSupplement(cachedIds = [], currentIds = []) {
  const a = [...cachedIds].sort((x, y) => x - y)
  const b = [...currentIds].sort((x, y) => x - y)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Afişi olmayan dizilere yedek görsel (2026-10-07): TMDB'de aynı dizinin afişsiz ikinci bir kaydı olabiliyor
 * (ör. Gupi 277655 / 304413) — önce aynı adlı kaydın afişi, yoksa dizinin yatay kapak görseli (backdrop).
 * Hiçbir görseli olmayan (TMDB'ye henüz görsel eklenmemiş yeni yapımlar) dizi yer tutucuyla kalır.
 */
export function fillMissingPosters(series = []) {
  const key = (n) =>
    String(n || '')
      .toLocaleLowerCase('tr')
      .trim()
  const byName = new Map()
  for (const s of series) if (s.posterPath && !byName.has(key(s.name))) byName.set(key(s.name), s.posterPath)
  for (const s of series) {
    if (s.posterPath) continue
    const fallback = byName.get(key(s.name)) || s.backdropPath || null
    if (fallback) s.posterPath = fallback
  }
  return series
}

/**
 * tabii'de yayında olan diziler, tabii'nin erişilebildiği ülkelerde yayın kaydına "tabii" olarak eklenir (o ülkede
 * kayıt zaten varsa ona). Hangi dizinin tabii'de olduğu ve ülkeler haftalık tabii taramasından gelir
 * (services/tabiiCatalog.js); tarama henüz yapılmadıysa TRT 1 yapımları ve src/data/tabii-countries.json yedeği.
 */
export function applyTabiiAvailability(raw, tabii = getCached(TABII_CACHE_KEY)) {
  const countries = tabii?.countries?.length ? tabii.countries : tabiiCountries.countries || []
  if (!countries.length) return raw
  const onTabii = tabii?.matched
    ? (s) => Boolean(tabii.matched[s.id])
    : (s) => s.broadcaster === 'TRT 1' || s.broadcaster === 'tabii'
  const provider = { provider_id: 'tabii', provider_name: 'tabii' }
  for (const s of raw.series || []) {
    if (!onTabii(s)) continue
    if (tabii?.matched?.[s.id]) s.tabiiUrl = tabii.matched[s.id].url
    const byCountry = (raw.providersById[s.id] ||= {})
    for (const iso2 of countries) {
      const e = (byCountry[iso2] ||= {})
      const list = (e.flatrate ||= [])
      if (!list.some((p) => p.provider_name === 'tabii')) list.push(provider)
    }
  }
  return raw
}

// Önbellekten gelen katalog nesnesi süreç belleğinde paylaşılır (cache.js MEMO_KEYS); süsleme her nesneye bir kez.
// tabii ülke listesi haftalık değişir: süsleme, tabii önbellek nesnesinin kimliğiyle birlikte anahtarlanır.
const decorated = new WeakMap() // raw → süslemede kullanılan tabii önbellek nesnesi
export async function getRawSeriesDataCached() {
  const raw = await readRawSeriesData()
  if (raw?.series) {
    const tabii = getCached(TABII_CACHE_KEY)
    if (!decorated.has(raw) || decorated.get(raw) !== tabii) {
      fillMissingPosters(raw.series)
      applyTabiiAvailability(raw, tabii)
      decorated.set(raw, tabii)
    }
  }
  return raw
}

async function readRawSeriesData() {
  const supplementIds = getCatalogSupplementIds()
  const cached = getCached(RAW_CACHE_KEY)
  // Ek dizi listesi, kadro kaynağı ya da katalog süzgeci değiştiyse katalog yeniden kurulur (24 saat beklenmez).
  if (
    cached &&
    sameSupplement(cached.supplementIds, supplementIds) &&
    cached.castSource === CAST_SOURCE &&
    cached.catalogFilter === CATALOG_FILTER
  )
    return cached
  if (rawFetchInFlight) return rawFetchInFlight

  rawFetchInFlight = (async () => {
    const data = await getRawSeriesData({ supplementIds })
    setCached(RAW_CACHE_KEY, data, RAW_CACHE_TTL_MS)
    return data
  })().finally(() => {
    rawFetchInFlight = null
  })

  return rawFetchInFlight
}

// LLM sınıflandırması (400 dizi × tema + destinasyon) ilk açılışta dakikalar sürebilir; LLM
// kapalıysa her dizi zaman aşımına düşer ve /api/visibility hiç yanıt vermezdi. Kullanıcı
// istekleri artık beklemez: sınıflandırma arka planda TEK bir iş olarak başlar (eş zamanlı
// istekler aynı işe bağlanır), harita o an elde olan etiketlerle döner — eksik olanlar
// buildVisibility'de zaten 'diğer' / güven 0 ile işlenir ve bir sonraki istekte güncel gelir.
// Zamanlanmış günlük tazeleme ise tamamlanmasını bekler (waitForClassification: true).
let enrichmentInFlight = null

function kickOffEnrichment(series) {
  if (enrichmentInFlight) return enrichmentInFlight
  enrichmentInFlight = (async () => {
    await ensureClassified(series)
    await ensureDetected(series)
  })()
    .catch((err) => {
      console.error('[visibility] arka plan sınıflandırma turu başarısız:', err.message)
    })
    .finally(() => {
      enrichmentInFlight = null
      visMemo = null // yeni etiketler bir sonraki istekte görünsün
    })
  return enrichmentInFlight
}

// Görünürlük modeli tek istekte birkaç yoldan kuruluyordu (inceleme C2): 60 sn süreç belleği + eş zamanlı
// çağrılar aynı kurulumu paylaşır. Sınıflandırmayı bekleyen (zamanlanmış) çağrı memo'yu atlar ve yeniler.
const VIS_MEMO_MS = 60_000
let visMemo = null // { at, value }
let visInFlight = null

export async function getEnrichedVisibility({ waitForClassification = false } = {}) {
  if (!waitForClassification && visMemo && Date.now() - visMemo.at < VIS_MEMO_MS) return visMemo.value
  if (visInFlight && !waitForClassification) return visInFlight
  const p = buildEnrichedVisibility({ waitForClassification })
    .then((v) => {
      visMemo = { at: Date.now(), value: v }
      return v
    })
    .finally(() => {
      if (visInFlight === p) visInFlight = null
    })
  visInFlight = p
  return p
}

/** Testler: görünürlük memo'sunu düşür. */
export function dropVisibilityMemo() {
  visMemo = null
}

async function buildEnrichedVisibility({ waitForClassification = false } = {}) {
  const raw = await getRawSeriesDataCached()
  const enrichment = kickOffEnrichment(raw.series)
  if (waitForClassification) await enrichment
  const data = buildVisibility(raw, getThemeStore(), getDestinationStore())
  const destinationStore = getDestinationStore()

  try {
    const fallback = await getFallbackInterestScores()
    data.countries = mergeProxyFallback(data.countries, fallback)
  } catch (err) {
    console.error('[visibility] arama hacmi fallback verisi alınamadı:', err.message)
  }
  data.countries = addLimitedCountries(data.countries)

  try {
    const demographics = await getCountryDemographics()
    data.countries = attachPerCapitaScores(data.countries, demographics)
  } catch (err) {
    console.error('[visibility] demografi verisi alınamadı, kişi başına skor hesaplanmadı:', err.message)
    data.countries = attachPerCapitaScores(data.countries, null)
  }

  const history = loadHistoryStore()
  data.countries = data.countries.map((c) =>
    c.dataSource === 'proxy'
      ? { ...c, trend: { direction: 'yetersiz-veri', changePct: null, windowDays: null }, history: [] }
      : { ...c, trend: getTrend(history, c.iso2, c.score), history: (history[c.iso2] || []).slice(-20) }
  )
  maybeRecordSnapshot(
    history,
    data.countries.filter((c) => c.dataSource !== 'proxy')
  )
  maybeRecordSeriesSnapshot(raw.series)
  // Tarihe göre rapor için: dizi × ülke × platform aralığı (günde bir kez).
  try {
    recordAvailability(raw.providersById)
  } catch (err) {
    console.error('[visibility] yayın durumu kaydı yazılamadı:', err.message)
  }

  return { data, raw, destinationStore }
}
