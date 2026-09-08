import db from '../db.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { getExpandedCandidatePool, getTravelLeadingIndicator, LEADING_INDICATOR_LAG_WEEKS } from './tourismCorrelation.js'
import { getSerpApiUsageThisMonth, TIMESERIES_TTL_MS } from './serpApiCache.js'

// "3-6 Aylık Öncü Turizm Sinyali" — tourismCorrelation.js'in computeTourismCorrelation'ı ANLIK
// bir istekte SADECE en yüksek görünürlüklü TEK ülke için öncü sinyal hesaplıyordu (bkz. o
// dosyadaki getTravelLeadingIndicator çağrısı). Burada AYNI fonksiyon (artık travelQuery
// parametreli) YİGM bültenine eşleşen ilk 15 ülke × 3 seyahat sorgusu ("Travel to Turkey",
// "Istanbul", "Antalya") için haftalık olarak çalıştırılır, sonuç tourism_leading_signal'e yazılır.
// Not: "Travel to Turkey" önceki gerçek testte İspanya'da neredeyse hep 0 çıkmıştı (bkz.
// tourismCorrelation.js'teki not) — o bulgu burada yok sayılmıyor, sadece kullanıcının açıkça
// istediği 3 sorgu da GERÇEK veriyle denenip sonuç ne çıkarsa dürüstçe kaydediliyor.
const TRAVEL_QUERIES = ['Travel to Turkey', 'Istanbul', 'Antalya']
const TOP_COUNTRY_COUNT = 15
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastTourismTrendsCollectAt'
const DELAY_AFTER_LIVE_CALL_MS = 1500

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const upsertSignalStmt = db.prepare(`
  INSERT INTO tourism_leading_signal
    (country_iso2, travel_query, top_series_name, lag_weeks, correlation, sample_size, computed_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(country_iso2, travel_query) DO UPDATE SET
    top_series_name = excluded.top_series_name,
    lag_weeks = excluded.lag_weeks,
    correlation = excluded.correlation,
    sample_size = excluded.sample_size,
    computed_at = excluded.computed_at,
    expires_at = excluded.expires_at
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runTourismTrendsCollectionIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  console.log('[tourismTrendsCollector] haftalık öncü turizm sinyali taraması başladı')
  let computed = 0
  let skippedNoSeries = 0
  let failed = 0

  try {
    const { data } = await getEnrichedVisibility()
    const candidates = getExpandedCandidatePool(data.countries, TOP_COUNTRY_COUNT)
    const nowIso = new Date().toISOString()

    outer: for (const candidate of candidates) {
      if (!candidate.topSeriesName) {
        // Bu ülke için henüz "öne çıkan dizi" bilgisi yok — uydurma bir dizi adıyla arama
        // yapılmaz, dürüstçe atlanır (bkz. computeTourismCorrelation'daki aynı prensip).
        skippedNoSeries++
        continue
      }
      for (const travelQuery of TRAVEL_QUERIES) {
        const usage = getSerpApiUsageThisMonth()
        // Her tur 2 gerçek çağrı harcayabilir (dizi + seyahat sorgusu TIMESERIES).
        if (usage.used >= usage.budget - 1) {
          const remaining = (candidates.length - computed - skippedNoSeries) * TRAVEL_QUERIES.length
          console.warn(
            `[tourismTrendsCollector] aylık SerpAPI kotası doldu (${usage.used}/${usage.budget}) — kalan ~${remaining} ülke/sorgu çifti bir sonraki döngüye bırakıldı.`
          )
          break outer
        }
        try {
          const signal = await getTravelLeadingIndicator(candidate.iso2, candidate.topSeriesName, travelQuery)
          if (signal) {
            upsertSignalStmt.run(
              candidate.iso2,
              travelQuery,
              candidate.topSeriesName,
              signal.lagWeeks,
              signal.correlation,
              signal.sampleSize,
              nowIso,
              Date.now() + TIMESERIES_TTL_MS
            )
            computed++
          }
        } catch (err) {
          failed++
          console.error(`[tourismTrendsCollector] ${candidate.iso2}/${travelQuery} hesaplanamadı:`, err.message)
        }
        await sleep(DELAY_AFTER_LIVE_CALL_MS)
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[tourismTrendsCollector] tarama tamamlandı — ${computed} sinyal hesaplandı (${skippedNoSeries} ülke dizi eksikliğinden atlandı, ${failed} hata).`
    )
  } catch (err) {
    console.error('[tourismTrendsCollector] öncü turizm sinyali taraması başarısız:', err.message)
  }
}

// /api/impact/tourism için özet — sadece HÂLÂ TAZE (expires_at > şimdi) satırlar döner, süresi
// dolmuş bir sinyal sessizce "güncel" gibi gösterilmez. En güçlü (|correlation| en yüksek) sinyal
// öne çıkarılır, ama TÜM satırlar da (frontend ileride isterse) dönülür.
const getFreshSignalsStmt = db.prepare(
  'SELECT country_iso2, travel_query, top_series_name, lag_weeks, correlation, sample_size, computed_at FROM tourism_leading_signal WHERE expires_at > ?'
)

// Pearson r'nin p<0,05 (çift yönlü) için kritik değeri. Örneklem küçükken |r| tesadüfen yüksek
// çıkabilir; bu eşik olmadan arayüz 0,27'lik bir gürültüyü "sinyal" diye gösterirdi. df = n-2 için
// t kritik değeri Student-t tablosundan yaklaşık alınır (df>30 aralığında 2,04 civarı, normale
// yakınsar) ve r_kritik = t / sqrt(df + t²) ile çevrilir. Yaklaşık bir eşiktir — kesin bir p
// değeri iddia edilmez, sadece "bu örneklemde bu büyüklük ayırt edilebilir mi" sorusuna dürüst
// bir evet/hayır verir.
function kritikKorelasyon(sampleSize) {
  const df = sampleSize - 2
  if (df < 3) return null
  // df>30 için t≈2,04; küçük örneklemlerde daha muhafazakâr (daha yüksek) eşikler.
  const t = df >= 30 ? 2.04 : df >= 20 ? 2.09 : df >= 10 ? 2.23 : 2.57
  return Math.round((t / Math.sqrt(df + t * t)) * 1000) / 1000
}

export function getTourismLeadingSignalSummary() {
  const rows = getFreshSignalsStmt.all(Date.now())
  if (rows.length === 0) {
    return { status: 'gerçek-veri-bekleniyor', lagWeeksRange: '3-6 ay', signals: [], strongestSignal: null }
  }
  const signals = rows.map((r) => {
    const criticalR = kritikKorelasyon(r.sample_size)
    return {
      iso2: r.country_iso2,
      travelQuery: r.travel_query,
      topSeriesName: r.top_series_name,
      lagWeeks: r.lag_weeks,
      correlation: r.correlation,
      sampleSize: r.sample_size,
      computedAt: r.computed_at,
      // Yön, büyüklükten AYRI taşınır: negatif korelasyon "zayıf pozitif" değil, TERS yönlü
      // hareket demektir ve arayüzde öyle gösterilmelidir.
      direction: r.correlation > 0 ? 'pozitif' : r.correlation < 0 ? 'negatif' : 'nötr',
      criticalR,
      significant: criticalR != null && Math.abs(r.correlation) >= criticalR,
    }
  })
  // Sıralama |r|'ye göre yapılır ama ÖNCE anlamlı olanlar gelir — böylece arayüzde en üstteki
  // satır her zaman "gösterilmeye değer" olandır.
  const sirali = [...signals].sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1
    return Math.abs(b.correlation) - Math.abs(a.correlation)
  })
  const anlamliSayisi = signals.filter((s) => s.significant).length
  return {
    status: 'gerçek-veri-mevcut',
    lagWeeksRange: `${LEADING_INDICATOR_LAG_WEEKS} hafta (~4 ay)`,
    countriesScanned: new Set(signals.map((s) => s.iso2)).size,
    signalCount: signals.length,
    significantCount: anlamliSayisi,
    signals: sirali,
    // Anlamlı bir sinyal YOKSA "en güçlü" diye bir şey öne çıkarmıyoruz — gürültüyü bulgu gibi
    // sunmak bu projedeki en temel dürüstlük kuralına aykırı olurdu.
    strongestSignal: anlamliSayisi > 0 ? sirali[0] : null,
  }
}
