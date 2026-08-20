import { getRawSeriesData } from './tmdb.js'
import { getCached, setCached } from './cache.js'
import { ensureClassified } from './themes.js'
import { ensureDetected } from './destinations.js'
import { buildVisibility, mergeProxyFallback } from './aggregate.js'
import { getTrend, maybeRecordSnapshot, loadHistoryStore } from './history.js'
import { getFallbackInterestScores } from './services/proxyScore.js'

const RAW_CACHE_KEY = 'raw-series-providers'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 saat

// index.js'teki route'lar ve scheduler.js'teki zamanlanmış tazeleme aynı
// hattı paylaşır — burada tek yerde tanımlı, ikisi de import eder.
export async function getRawSeriesDataCached() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached
  const data = await getRawSeriesData()
  setCached(RAW_CACHE_KEY, data, RAW_CACHE_TTL_MS)
  return data
}

// /api/visibility ve /api/impact aynı gerçek, canlı veriyi paylaşır — tema/destinasyon
// sınıflandırması ve trend/history zenginleştirmesi burada bir kez yapılır.
export async function getEnrichedVisibility() {
  const raw = await getRawSeriesDataCached()
  const themeStore = await ensureClassified(raw.series)
  const destinationStore = await ensureDetected(raw.series)
  const data = buildVisibility(raw, themeStore, destinationStore)

  // Eksik ülke fallback katmanı: SERPAPI_API_KEY tanımlı değilse, aylık kota dolmuşsa veya
  // geçici bir ağ hatası olursa /api/visibility'nin tamamını düşürmek yerine dürüstçe fallback'siz
  // devam eder — TMDB verisi zaten elde, sadece ~9 ülkelik boşluk doldurulamamış olur.
  try {
    const fallback = await getFallbackInterestScores()
    data.countries = mergeProxyFallback(data.countries, fallback)
  } catch (err) {
    console.error('[visibility] arama hacmi fallback verisi alınamadı:', err.message)
  }

  const history = loadHistoryStore()
  // Proxy ülkelerin skoru sabit 0 olduğu için gerçek bir trend hesaplamak (getTrend) hep
  // "sabit" gibi uydurma bir sonuç üretirdi ve visibility_history tablosuna anlamsız 0 kayıtları
  // birikirdi — bu yüzden dürüstçe "yetersiz-veri" gösterilir ve snapshot'a hiç dahil edilmezler.
  data.countries = data.countries.map((c) =>
    c.dataSource === 'proxy'
      ? { ...c, trend: { direction: 'yetersiz-veri', changePct: null, windowDays: null }, history: [] }
      : { ...c, trend: getTrend(history, c.iso2, c.score), history: (history[c.iso2] || []).slice(-20) }
  )
  maybeRecordSnapshot(history, data.countries.filter((c) => c.dataSource !== 'proxy'))

  return { data, raw, destinationStore }
}
