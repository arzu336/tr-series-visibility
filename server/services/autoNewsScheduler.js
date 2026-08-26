import db from '../db.js'
import { getEnrichmentTargets } from './enrichmentTargets.js'
import { fetchAndAnalyzeSentiment } from './newsSentiment.js'
import { getSerpApiUsageThisMonth } from './serpApiCache.js'

// Kullanıcı şimdiye kadar media_sentiment'i SADECE /api/media-sentiment/:seriesId/:iso2'yi tek
// tek tıklayarak dolduruyordu (bkz. newsSentiment.js) — hiç kimse tıklamazsa Kültürel Etki
// sekmesindeki özet sonsuza kadar boş/eksik kalırdı. Burada AYNI fetchAndAnalyzeSentiment
// fonksiyonu (kendi 30 günlük TTL'i, kendi "yetersiz-veri" dürüstlüğü, kendi LLM hata toleransı)
// haftalık bir döngüyle en popüler 20 dizi × en görünür 15 ülke için PROAKTİF çağrılıyor — yeni
// bir veri modeli YOK, sadece var olan tetikleme mekanizmasının otomatikleştirilmesi.
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastAutoNewsScanAt'
const DELAY_AFTER_LIVE_CALL_MS = 1500 // SerpAPI'yi art arda yüzlerce gerçek istekle aniden boğmamak için

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Tek bir dizi × verilen ülke listesi için basın taraması — hem haftalık toplu döngü
// (runAutoNewsScanIfNeeded, her dizi için bunu çağırır) hem de TrendsExplorer.jsx'in "Gelişmiş
// Medya & Sosyal Taramayı Çalıştır" anlık tetikleyicisi (enrichSeriesNewsNow) AYNI mantığı
// paylaşır — throttle:true haftalık toplu iş için (yüzlerce isteği aniden atmamak), throttle:false
// anlık tetikleyici için (kullanıcı zaten aktif bekliyor, tek dizilik sınırlı bir tarama).
async function scanSeriesAcrossCountries(seriesId, seriesName, countryIso2s, { throttle } = {}) {
  let scanned = 0
  let liveCalls = 0
  let failed = 0
  let budgetExhausted = false
  for (const iso2 of countryIso2s) {
    const usage = getSerpApiUsageThisMonth()
    if (usage.used >= usage.budget) {
      budgetExhausted = true
      break
    }
    try {
      // fetchAndAnalyzeSentiment kendi 30 günlük TTL'ini kontrol eder — zaten taze bir kayıt
      // varsa burada gerçek bir SerpAPI/LLM çağrısı YAPILMAZ, fromCache:true döner.
      const result = await fetchAndAnalyzeSentiment(seriesId, seriesName, null, iso2)
      scanned++
      if (!result.fromCache) {
        liveCalls++
        if (throttle) await sleep(DELAY_AFTER_LIVE_CALL_MS)
      }
    } catch (err) {
      failed++
      console.error(`[autoNewsScheduler] ${seriesName}/${iso2} taranamadı:`, err.message)
    }
  }
  return { scanned, liveCalls, failed, budgetExhausted }
}

export async function runAutoNewsScanIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  console.log('[autoNewsScheduler] haftalık otomatik basın taraması başladı')
  let totalScanned = 0
  let totalLive = 0
  let totalFailed = 0

  try {
    const { topSeries, topCountries } = await getEnrichmentTargets()

    for (const series of topSeries) {
      const result = await scanSeriesAcrossCountries(series.id, series.name, topCountries, { throttle: true })
      totalScanned += result.scanned
      totalLive += result.liveCalls
      totalFailed += result.failed
      if (result.budgetExhausted) {
        console.warn('[autoNewsScheduler] aylık SerpAPI kotası doldu — kalan diziler bir sonraki döngüye bırakıldı.')
        break
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[autoNewsScheduler] tarama tamamlandı — ${totalScanned} çift işlendi (${totalLive} canlı SerpAPI çağrısı, ${totalFailed} hata).`
    )
  } catch (err) {
    console.error('[autoNewsScheduler] otomatik basın taraması başarısız:', err.message)
  }
}

// TrendsExplorer.jsx — "Gelişmiş Medya & Sosyal Taramayı Çalıştır" butonu. Haftalık işin
// meta-kapısı ve 20-dizilik döngüsü YOK, sadece verilen TEK dizi × verilen ülke listesi;
// kullanıcı sonucu aktif beklediği için throttle uygulanmaz, ama aylık bütçe koruması aynen geçerli.
export async function enrichSeriesNewsNow(seriesId, seriesName, countryIso2s) {
  return scanSeriesAcrossCountries(seriesId, seriesName, countryIso2s, { throttle: false })
}
