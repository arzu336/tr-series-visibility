import db from '../db.js'
import { getEnrichmentTargets } from './enrichmentTargets.js'
import {
  cacheFirstSerpApi,
  fetchLocalizedSocialListeningRaw,
  fetchSocialListeningRaw,
  localizedSocialCacheKey,
  socialCacheKey,
  getSerpApiUsageThisMonth,
  SOCIAL_TTL_MS,
} from './serpApiCache.js'

// Haftalık iş küçültüldü (2026-10-13, kullanıcı: "haftalık küçültülmüş şekilde aç"): eski iş 35 dizi × 25 ülke için
// ülkeye özel kayıt topluyordu (~1.750 ücretli sorgu) ama bu kayıtları hiçbir sayfa göstermiyordu. Dizi sayfasının
// "Tanıtım" bölümü dizi başına tek genel kaydı (bilgi kartı + YouTube fragmanı) okur; haftalık iş artık yalnızca bunu,
// öne çıkan WEEKLY_SERIES dizi için yeniler: dizi başına 2 sorgu, haftada en fazla 80. Kota %80'de durur.
export const WEEKLY_SERIES = 40
const USAGE_STOP_SHARE = 0.8
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastSocialEnrichAt'
const DELAY_AFTER_LIVE_CALL_MS = 1500

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function enrichSeriesAcrossCountries(seriesName, countryIso2s, { throttle } = {}) {
  let scanned = 0
  let liveCalls = 0
  let failed = 0
  let budgetExhausted = false
  for (const iso2 of countryIso2s) {
    const usage = getSerpApiUsageThisMonth()
    if (usage.used >= usage.budget - 1) {
      budgetExhausted = true
      break
    }
    try {
      const key = localizedSocialCacheKey(seriesName, iso2)
      const result = await cacheFirstSerpApi(key, SOCIAL_TTL_MS, () =>
        fetchLocalizedSocialListeningRaw(seriesName, iso2)
      )
      scanned++
      if (!result.fromCache) {
        liveCalls++
        if (throttle) await sleep(DELAY_AFTER_LIVE_CALL_MS)
      }
    } catch (err) {
      failed++
      console.error(`[socialEnricher] ${seriesName}/${iso2} zenginleştirilemedi:`, err.message)
    }
  }
  return { scanned, liveCalls, failed, budgetExhausted }
}

export async function runSocialEnrichmentIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  console.log('[socialEnricher] haftalık tanıtım (bilgi kartı + YouTube) yenilemesi başladı')
  let totalScanned = 0
  let totalLive = 0
  let totalFailed = 0

  try {
    const { topSeries } = await getEnrichmentTargets({ seriesCount: WEEKLY_SERIES })

    for (const series of topSeries) {
      const usage = getSerpApiUsageThisMonth()
      if (usage.used >= usage.budget * USAGE_STOP_SHARE) {
        console.warn('[socialEnricher] aylık kotanın %80’i doldu — kalan diziler bir sonraki haftaya bırakıldı.')
        break
      }
      try {
        // Haftalık tazelik: kayıt bir haftadan eskiyse yenilenir.
        const result = await cacheFirstSerpApi(socialCacheKey(series.name), WEEKLY_MS, () =>
          fetchSocialListeningRaw(series.name)
        )
        totalScanned++
        if (!result.fromCache) {
          totalLive += 2
          await sleep(DELAY_AFTER_LIVE_CALL_MS)
        }
      } catch (err) {
        totalFailed++
        console.error(`[socialEnricher] ${series.name} tanıtım verisi alınamadı:`, err.message)
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(`[socialEnricher] tamamlandı — ${totalScanned} dizi (${totalLive} ücretli sorgu, ${totalFailed} hata).`)
  } catch (err) {
    console.error('[socialEnricher] sosyal zenginleştirme başarısız:', err.message)
  }
}

export async function enrichSeriesSocialNow(seriesName, countryIso2s) {
  return enrichSeriesAcrossCountries(seriesName, countryIso2s, { throttle: false })
}
