import db from '../db.js'
import { getEnrichmentTargets } from './enrichmentTargets.js'
import { fetchAndAnalyzeSentiment } from './newsSentiment.js'

// Kullanıcı şimdiye kadar media_sentiment'i SADECE /api/media-sentiment/:seriesId/:iso2'yi tek
// tek tıklayarak dolduruyordu (bkz. newsSentiment.js) — hiç kimse tıklamazsa Kültürel Etki
// sekmesindeki özet sonsuza kadar boş/eksik kalırdı. Burada AYNI fetchAndAnalyzeSentiment
// fonksiyonu (kendi 30 günlük TTL'i, kendi "yetersiz-veri" dürüstlüğü, kendi LLM hata toleransı)
// haftalık bir döngüyle en popüler 20 dizi × en görünür 15 ülke için PROAKTİF çağrılıyor — yeni
// bir veri modeli YOK, sadece var olan tetikleme mekanizmasının otomatikleştirilmesi.
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastAutoNewsScanAt'
// Denetim raporu D.6 sonrası: haber çağrıları artık ücretsiz GDELT'e gidiyor ve gdeltNews.js
// zaten KENDİ İÇİNDE 20 sn'lik global bir aralık uyguluyor — buradaki ek gecikme onun üstüne
// binmiyor, sadece LLM analizleri arasında küçük bir nefes payı bırakıyor.
const DELAY_AFTER_LIVE_CALL_MS = 1500

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
  for (const iso2 of countryIso2s) {
    // Denetim raporu D.6: burada eskiden aylık SerpAPI kotası kontrol ediliyor ve kota dolduğunda
    // tarama duruyordu. Haber kaynağı ücretsiz GDELT'e taşındıktan sonra bu kapı YANLIŞ hâle
    // geldi: tamamen ilgisiz bir bütçe (Google Trends çağrıları) tükendiği için ücretsiz basın
    // taraması durdurulmuş olurdu. Kaldırıldı. Bu döngüyü sınırlayan gerçek üst sınır zaten
    // çağıranın verdiği liste (haftalık iş: 20 dizi × 15 ülke) ve gdeltNews.js'in kendi hız
    // kuyruğu; LLM tarafında da fetchAndAnalyzeSentiment'in 14 günlük TTL'i tekrarı önlüyor.
    try {
      // fetchAndAnalyzeSentiment kendi TTL'ini kontrol eder — zaten taze bir kayıt varsa burada
      // gerçek bir GDELT/LLM çağrısı YAPILMAZ, fromCache:true döner.
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
  return { scanned, liveCalls, failed }
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
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[autoNewsScheduler] tarama tamamlandı — ${totalScanned} çift işlendi (${totalLive} canlı GDELT çağrısı, ${totalFailed} hata).`
    )
  } catch (err) {
    console.error('[autoNewsScheduler] otomatik basın taraması başarısız:', err.message)
  }
}

// TrendsExplorer.jsx — "Gelişmiş Medya & Sosyal Taramayı Çalıştır" butonu. Haftalık işin
// meta-kapısı ve 20-dizilik döngüsü YOK, sadece verilen TEK dizi × verilen ülke listesi;
// kullanıcı sonucu aktif beklediği için burada ek gecikme uygulanmaz — ama gdeltNews.js'in kendi
// 20 sn'lik global aralığı yine geçerli olduğundan çok ülkeli bir tarama yine de yavaş ilerler.
export async function enrichSeriesNewsNow(seriesId, seriesName, countryIso2s) {
  return scanSeriesAcrossCountries(seriesId, seriesName, countryIso2s, { throttle: false })
}
