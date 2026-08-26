import db from '../db.js'
import { getEnrichmentTargets } from './enrichmentTargets.js'
import {
  cacheFirstSerpApi,
  fetchLocalizedSocialListeningRaw,
  localizedSocialCacheKey,
  getSerpApiUsageThisMonth,
  SOCIAL_TTL_MS,
} from './serpApiCache.js'

// Aynı 20 dizi × 15 ülke havuzu (bkz. autoNewsScheduler.js, enrichmentTargets.js) için hedef
// ülkeye YERELLEŞTİRİLMİŞ Bilgi Grafiği (yayın platformu, puanlar, varsa izleyici beğeni yüzdesi)
// + o dildeki en çok izlenen resmi fragman. server/social-listening.js'teki mevcut
// querySocialListening HER ZAMAN Türkiye'ye sabit (gl:'tr', "fragman" kelimesi) — burası
// fetchLocalizedSocialListeningRaw ile ÜLKEYE göre ayrışır, cache_entries'te ayrı bir anahtar
// altında (serp:social-local:...) tutulur, var olan serp:social:... kayıtlarıyla çakışmaz.
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

// Tek bir dizi × verilen ülke listesi için sosyal/YouTube zenginleştirmesi — hem haftalık toplu
// döngü (runSocialEnrichmentIfNeeded, her dizi için bunu çağırır) hem de TrendsExplorer.jsx'in
// anlık tetikleyicisi (enrichSeriesSocialNow) AYNI mantığı paylaşır.
async function enrichSeriesAcrossCountries(seriesName, countryIso2s, { throttle } = {}) {
  let scanned = 0
  let liveCalls = 0
  let failed = 0
  let budgetExhausted = false
  for (const iso2 of countryIso2s) {
    const usage = getSerpApiUsageThisMonth()
    // Her tur 2 gerçek çağrı harcayabilir (Bilgi Grafiği + YouTube) — tek çağrılık pay kalmışsa
    // bile devam etmek yarım/tutarsız bir kayıt üretebileceği için burada durulur.
    if (usage.used >= usage.budget - 1) {
      budgetExhausted = true
      break
    }
    try {
      const key = localizedSocialCacheKey(seriesName, iso2)
      const result = await cacheFirstSerpApi(key, SOCIAL_TTL_MS, () => fetchLocalizedSocialListeningRaw(seriesName, iso2))
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

  console.log('[socialEnricher] haftalık sosyal/YouTube zenginleştirme başladı')
  let totalScanned = 0
  let totalLive = 0
  let totalFailed = 0

  try {
    const { topSeries, topCountries } = await getEnrichmentTargets()

    for (const series of topSeries) {
      const result = await enrichSeriesAcrossCountries(series.name, topCountries, { throttle: true })
      totalScanned += result.scanned
      totalLive += result.liveCalls
      totalFailed += result.failed
      if (result.budgetExhausted) {
        console.warn('[socialEnricher] aylık SerpAPI kotası doldu — kalan diziler bir sonraki döngüye bırakıldı.')
        break
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[socialEnricher] zenginleştirme tamamlandı — ${totalScanned} çift işlendi (${totalLive} canlı SerpAPI çağrısı, ${totalFailed} hata).`
    )
  } catch (err) {
    console.error('[socialEnricher] sosyal zenginleştirme başarısız:', err.message)
  }
}

// TrendsExplorer.jsx — "Gelişmiş Medya & Sosyal Taramayı Çalıştır" butonu.
export async function enrichSeriesSocialNow(seriesName, countryIso2s) {
  return enrichSeriesAcrossCountries(seriesName, countryIso2s, { throttle: false })
}

// Kültürel Etki sekmesi için özet — cache_entries'te "serp:social-local:%" anahtarlı, süresi
// dolmamış kayıtlar taranır. Kaç dizi/ülke çiftinin en az bir yayın platformu bulduğu ve kaçının
// puan içerdiği dürüstçe sayılır — hiç tarama yoksa boş özet döner, uydurma bir sayı üretilmez.
const scanLocalizedSocialStmt = db.prepare(
  "SELECT value FROM cache_entries WHERE key LIKE 'serp:social-local:%' AND expires_at > ?"
)

export function getSocialEnrichmentSummary() {
  const rows = scanLocalizedSocialStmt.all(Date.now())
  if (rows.length === 0) {
    return { status: 'pending', scannedCount: 0 }
  }
  let withPlatform = 0
  let withRatings = 0
  let withTrailer = 0
  for (const row of rows) {
    const entry = JSON.parse(row.value)
    if (entry.knowledgeGraph?.watchPlatforms?.length > 0) withPlatform++
    if (entry.knowledgeGraph?.ratings?.length > 0) withRatings++
    if (entry.youtube?.link) withTrailer++
  }
  return {
    status: 'ready',
    scannedCount: rows.length,
    withPlatformCount: withPlatform,
    withRatingsCount: withRatings,
    withTrailerCount: withTrailer,
  }
}
