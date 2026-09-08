import db from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { purgeExpiredCacheEntries } from './cache.js'
import { getEnrichedVisibility } from './data-pipeline.js'
import { rollupMonthlyIfNeeded } from './period-history.js'
import { rollupSeriesMonthlyIfNeeded } from './series-period-history.js'
import { syncTourismDataIfNeeded } from './services/tourismData.js'
import { runAutoNewsScanIfNeeded } from './services/autoNewsScheduler.js'
import { runTourismTrendsCollectionIfNeeded } from './services/tourismTrendsCollector.js'
import { runSocialEnrichmentIfNeeded } from './services/socialEnricher.js'
import { runActorTrendsCollectionIfNeeded } from './services/actorTrendsCollector.js'

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // her 30 dakikada bir "sırası geldi mi" kontrolü
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // hedef: günde 1 kez
export const META_KEY = 'lastScheduledRefreshAt'

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

// Denetim B-10: "çalışıyor" bayrağı yoktu. 30 dakikadan uzun süren bir tur (875 dizi×ülke
// çifti, aralarda 1,5 sn bekleme ve 25 sn LLM zaman aşımlarıyla saatler sürebiliyor) bir sonraki
// tetiklemede PARALEL olarak yeniden başlıyor, aynı SerpAPI harcaması ikiye katlanıyordu —
// çünkü haftalık kapılar (meta anahtarları) ancak iş BİTTİĞİNDE yazılıyor.
let refreshRunning = false

async function runScheduledRefresh() {
  // Denetim B-10: bayrak, hangi yoldan çıkılırsa çıkılsın (hata dahil) mutlaka sıfırlanmalı —
  // aksi halde tek bir istisna scheduler'ı kalıcı olarak susturur.
  if (refreshRunning) {
    console.log('[scheduler] önceki tur hâlâ sürüyor — bu tetikleme atlandı')
    return
  }
  refreshRunning = true
  try {
    await runScheduledRefreshInner()
  } finally {
    refreshRunning = false
  }
}

async function runScheduledRefreshInner() {
  console.log('[scheduler] zamanlanmış veri tazeleme başladı')
  try {
    // Süresi geçmiş oturum satırları eskiden yalnızca "sunulduklarında" siliniyordu, tablo
    // sınırsız büyüyordu (denetim G-15).
    const purged = purgeExpiredSessions()
    if (purged > 0) console.log(`[scheduler] süresi geçmiş ${purged} oturum temizlendi`)

    // Denetim bulgusu B-20: cache_entries'ten hiç satır silinmiyordu — süresi dolmuş kayıtlar
    // okunmuyor ama diskte kalıyor ve içerik hash'iyle anahtarlanan girdiler her değişimde yeni
    // satır ürettiği için tablo tek yönlü büyüyor. Oturum temizliğiyle aynı ritimde, ucuz bir
    // DELETE. Yalnızca süresi GEÇMİŞ satırlar silinir; taze önbelleğe dokunulmaz.
    const purgedCache = purgeExpiredCacheEntries()
    if (purgedCache > 0) console.log(`[scheduler] süresi geçmiş ${purgedCache} önbellek kaydı temizlendi`)

    await getEnrichedVisibility()
    // Ham visibility_history budanmadan önce (bkz. MAX_SNAPSHOTS_PER_COUNTRY, history.js)
    // tamamlanmış ayları kalıcı özet tabloya taşır — kendi günlük kapısı var (period-history.js).
    rollupMonthlyIfNeeded()
    rollupSeriesMonthlyIfNeeded()
    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log('[scheduler] zamanlanmış veri tazeleme tamamlandı')
  } catch (err) {
    console.error('[scheduler] zamanlanmış veri tazeleme başarısız:', err.message)
  }

  // Turizm bülteni ayda bir yayınlanıyor — günlük tazelemeden BAĞIMSIZ, kendi haftalık kapısıyla
  // (tourismData.js) çalışır; başarısız olursa (site erişilemez, format değişmiş) diğer hiçbir
  // özelliği etkilemez.
  try {
    await syncTourismDataIfNeeded()
  } catch (err) {
    console.error('[scheduler] turizm verisi senkronizasyonu başarısız:', err.message)
  }

  // SerpAPI'ye dayalı 4 haftalık toplu zenginleştirme (basın taraması, öncü turizm sinyali,
  // sosyal/YouTube, oyuncu arama ilgisi) — sırayla (paralel DEĞİL) çalıştırılır ki paylaşılan
  // aylık kota bütçesi (bkz. serpApiCache.js SERPAPI_MONTHLY_BUDGET) dördü arasında öngörülebilir
  // şekilde bölüşülsün. Her biri kendi 7 günlük meta-kapısını kontrol eder, hazır değilse anında
  // döner; biri başarısız olursa (kota, ağ) diğerleri etkilenmez. Sıra bilerek en pahalıdan en
  // ucuza değil, mevcut 3'ün ardına en ucuz/en yeni işin (oyuncu, ~30 çağrı/tur) eklenmesi
  // şeklinde — böylece bütçe daralırsa önce daha büyük/öncelikli kalemler (basın/sosyal) payını alır.
  try {
    await runAutoNewsScanIfNeeded()
  } catch (err) {
    console.error('[scheduler] otomatik basın taraması başarısız:', err.message)
  }
  try {
    await runTourismTrendsCollectionIfNeeded()
  } catch (err) {
    console.error('[scheduler] öncü turizm sinyali taraması başarısız:', err.message)
  }
  // Denetim raporu C.3 — "yetim sinyaller": aşağıdaki iki haftalık tarama her hafta ücretli
  // SerpAPI çağrısı yapıp veriyi tabloya/önbelleğe yazıyor, ama sonucu ARAYÜZDE HİÇBİR YERDE
  // gösterilmiyordu (socialEnrichmentSummary impact.js'te dönüyor ama src/ içinde okunmuyor;
  // actor_country_interest'in getter'ı hiçbir yerden çağrılmıyor). Kullanıcı kararıyla ikisi de
  // VARSAYILAN OLARAK KAPALI — kod silinmedi, bir env bayrağıyla geri açılabilir.
  //
  // ÖNEMLİ: bu yalnızca ZAMANLANMIŞ toplu taramayı kapatır. TrendsExplorer'daki "Gelişmiş Medya
  // & Sosyal Taramayı Çalıştır" butonu (enrichSeriesSocialNow) etkilenmez — kullanıcı istediğinde
  // yine canlı tarama yapabilir, yani görünür bir özellik kaybı yok.
  if (process.env.ENABLE_SOCIAL_ENRICHMENT === 'true') {
    try {
      await runSocialEnrichmentIfNeeded()
    } catch (err) {
      console.error('[scheduler] sosyal zenginleştirme başarısız:', err.message)
    }
  }
  if (process.env.ENABLE_ACTOR_TRENDS === 'true') {
    try {
      await runActorTrendsCollectionIfNeeded()
    } catch (err) {
      console.error('[scheduler] oyuncu trend taraması başarısız:', err.message)
    }
  }
}

// Proje raporunun §4.7'sinde önerilen n8n tabanlı "zamanlanmış tetikleme"
// katmanının kod-içi karşılığı — ayrı bir workflow aracı kurmadan, TMDB +
// LLM tema sınıflandırma + görünürlük geçmişi anlık görüntüsünü günde bir
// kez otomatik tetikler. Böylece hiç kullanıcı gelmese bile trend takibi
// (visibility_history) kesintiye uğramaz ve veri her zaman en fazla ~24
// saatlik.
//
// IMDb (OMDb) bilerek bu döngüye DAHİL EDİLMEDİ: talep-üzerine ve kendi kotası var, 200 diziyi
// otomatik taramak o kotayı anında tüketir. TMDB ve dahili LLM sunucusunun böyle bir kısıtı yok.
//
// SerpAPI ise ARTIK dahil — plan 5.000 sorgu/ay'a yükseltildi (2026-08-26, kullanıcı teyidi; bu
// yorumun önceki "250 sorgu/ay" hâli GÜNCEL DEĞİLDİ). Yine de tüm SerpAPI çağrıları TEK bir
// merkezi aylık bütçe sayacından geçiyor (bkz. serpApiCache.js SERPAPI_MONTHLY_BUDGET) — bu
// üç haftalık toplu iş (aşağıda) o bütçeyi kullanıcı tetiklemeli aramalarla (trend/sosyal/basın
// tıklamaları) PAYLAŞIR, aşarsa dürüstçe kalanı bir sonraki haftaya bırakır, uygulamayı çökertmez.
export function startScheduler() {
  // .unref(): bu zamanlayıcı tek başına Node sürecini ayakta TUTMASIN — sunucu kapatılırken
  // (SIGTERM/test sonu) 30 dakikalık bir timer yüzünden asılı kalmaz (denetim B-10).
  setInterval(() => {
    const row = getMetaStmt.get(META_KEY)
    const lastRunAt = row ? Number(row.value) : 0
    if (Date.now() - lastRunAt >= REFRESH_INTERVAL_MS) {
      runScheduledRefresh()
    }
  }, CHECK_INTERVAL_MS).unref()
}
