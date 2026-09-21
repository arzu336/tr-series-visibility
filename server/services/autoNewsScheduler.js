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

// --- Neden bir süre sınırı var (canlı veriyle teşhis edildi) -----------------------------------
// GDELT geçişinden (D.6) önce basın taraması hızlıydı: SerpAPI çağrıları arasında zorunlu bir
// bekleme yoktu. GDELT'in 20 sn'lik global kuyruğu (gdeltNews.js MIN_GAP_MS) turu 875 çift ×
// ~40 sn ≈ 10 SAATE çıkardı ve bu, scheduler.js'te ARKASINDA sıra bekleyen işleri açlığa itti:
//   lastAutoNewsScanAt      → hiç yazılmamış (tur bir kez bile tamamlanamadı)
//   lastTourismTrendsCollectAt → 2026-08-26'da donmuş (kapısı 7 gün) — yani 26 gün boyunca
//                                öncü turizm sinyali toplayıcısına sıra hiç gelmedi
// Çözüm tek bir turu hızlandırmak değil (GDELT'in hız sınırı pazarlık konusu değil), turu
// DİLİMLERE bölmek: her çağrı en fazla MAX_RUN_MS kadar çalışır, sonra sırayı bırakır. İlerleme
// kaybolmaz çünkü her çift tarandığı anda media_sentiment'e yazılıyor (bkz. newsSentiment.js
// upsertStmt) — bir sonraki dilim aynı listeyi baştan yürür, taranmış çiftler önbellekten
// milisaniyelerle geçilir ve iş ilk canlı çağrı gereken çiftten devam eder. Ayrı bir ilerleme
// tablosuna gerek yok: önbelleğin kendisi ilerleme kaydıdır.
//
// Tick aralığı 30 dk olduğu için sınır bilerek onun ALTINDA (25 dk): her dilim bir sonraki
// tetiklemeden önce biter, arkadaki iş her yarım saatte bir mutlaka sırasını alır.
const MAX_RUN_MS = 25 * 60 * 1000
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
// Dışa açık: hem haftalık toplu işin hem anlık tetikleyicinin ortak çekirdeği olduğu için
// davranışı (özellikle süre sınırının çifti YARIDA KESMEMESİ) birim testiyle sabitleniyor.
export async function scanSeriesAcrossCountries(seriesId, seriesName, countryIso2s, { throttle, deadline } = {}) {
  let scanned = 0
  let liveCalls = 0
  let failed = 0
  let deadlineReached = false
  for (const iso2 of countryIso2s) {
    // Süre kontrolü çifte BAŞLAMADAN önce: yarıda kesilen bir çift, GDELT çağrısı yapılmış ama
    // sonucu yazılmamış hâlde kalırdı. Sınır yalnızca bu toplu işi böler; anlık tetikleyici
    // (enrichSeriesNewsNow) deadline vermez, o yüzden davranışı değişmez.
    if (deadline && Date.now() >= deadline) {
      deadlineReached = true
      break
    }
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
  return { scanned, liveCalls, failed, deadlineReached }
}

export async function runAutoNewsScanIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  const deadline = Date.now() + MAX_RUN_MS
  console.log('[autoNewsScheduler] haftalık otomatik basın taraması dilimi başladı')
  let totalScanned = 0
  let totalLive = 0
  let totalFailed = 0
  let tamamlandi = true

  try {
    const { topSeries, topCountries } = await getEnrichmentTargets()

    for (const series of topSeries) {
      const result = await scanSeriesAcrossCountries(series.id, series.name, topCountries, {
        throttle: true,
        deadline,
      })
      totalScanned += result.scanned
      totalLive += result.liveCalls
      totalFailed += result.failed
      if (result.deadlineReached) {
        tamamlandi = false
        break
      }
    }

    // Haftalık kapı YALNIZCA tam bir tur bittiğinde kapanır. Yarım kalan dilimde yazılsaydı tarama
    // her hafta aynı ilk dizilerde takılır, listenin sonundaki diziler hiç taranmazdı.
    if (tamamlandi) {
      setMetaStmt.run(META_KEY, String(Date.now()))
      console.log(
        `[autoNewsScheduler] TUR TAMAMLANDI — bu dilimde ${totalScanned} çift işlendi (${totalLive} canlı GDELT çağrısı, ${totalFailed} hata).`
      )
    } else {
      console.log(
        `[autoNewsScheduler] dilim süre sınırına ulaştı — ${totalScanned} çift işlendi (${totalLive} canlı GDELT çağrısı, ${totalFailed} hata). Tur bitmedi, sıradaki tetiklemede kaldığı yerden devam edecek.`
      )
    }
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
