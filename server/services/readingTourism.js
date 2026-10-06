import db from '../db.js'
import { languagesOfCountry } from '../../src/lib/langCountries.js'
import { pearsonCorrelation, pValueForPearsonR } from './tourismCorrelation.js'
import { getTrackedIso2s, getVisitorSeries } from './tourismData.js'

// Okunma ilgisi × turist girişi: bir ülkenin dillerinde Türk dizilerine ait ansiklopedi maddelerinin aylık
// okunması (2015'ten beri) ile o ülkeden Türkiye'ye gelen ziyaretçi sayısı (2016'dan beri, resmî sınır
// istatistiği). Önceki korelasyon yayın görünürlüğüyle yapılıyordu; o seri yalnızca 3 aylık olduğu için
// hiçbir ülkede hesaplanamıyordu.
//
// Yöntem — sahte korelasyondan kaçınmak için:
//   - Mevsimsellik: iki seri de yazın yükselir. Ham değerler değil, geçen yılın aynı ayına göre değişim
//     (log oranı) karşılaştırılır.
//   - Pandemi: 2020–2022 ayları (2022'nin karşılaştırma tabanı 2021) dışarıda bırakılır. Kalan iki dönemin
//     (öncesi, sonrası) değişimleri kendi dönemindeki doğrusal eğilimden sapma olarak alınır: pandemi sonrası
//     turizm büyümesi yavaşlarken ansiklopedi okunması genel olarak düştüğü için, eğilimler tek başına sahte
//     bir ters korelasyon üretiyordu.
//   - Gecikme: ilginin seyahate dönüşmesi zaman alabilir; 0–6 ay gecikme denenir, en güçlüsü raporlanır.
//     Yedi deneme yapıldığı için anlamlılık eşiği Bonferroni ile düzeltilir (p × 7 < 0,05).
//   - Bağımlı gözlemler: yıllık değişim serilerinde art arda aylar 11 ayı paylaşır; 70 ay 70 bağımsız
//     gözlem değildir. Anlamlılık, iki serinin özilişkisine göre düzeltilmiş ETKİN örneklem büyüklüğüyle
//     (Pyper & Peterman 1998) hesaplanır — düzeltmesiz testler rastgele dalgalanmayı "anlamlı" gösteriyordu.
//   - Ortak diller (Arapça, İngilizce, İspanyolca…) birden çok ülkede konuşulduğundan okunma o ülkeye
//     ayrılamaz; yalnızca ülkeye özgü diller kullanılır.
// Korelasyon nedensellik değildir.

export const MAX_LAG_MONTHS = 6
export const MIN_PAIRS = 24
const EXCLUDED_YEARS = new Set([2020, 2021, 2022])
const periodOf = (k) => (Number(k.slice(0, 4)) < 2020 ? 'once' : 'sonra')

/**
 * Her dönemde doğrusal eğilimden sapma: dönem içi ortak eğilimler (pandemi sonrası turizm büyümesinin
 * yavaşlaması, ansiklopedi okunmasının genel düşüşü) iki seriyi birbirine bağlıymış gibi gösteriyordu.
 * `times`: ay sırası (yıl × 12 + ay).
 */
export function detrendByPeriod(values, periods, times) {
  const out = new Array(values.length)
  for (const p of new Set(periods)) {
    const idx = periods.map((q, i) => (q === p ? i : -1)).filter((i) => i >= 0)
    const n = idx.length
    const mt = idx.reduce((a, i) => a + times[i], 0) / n
    const mv = idx.reduce((a, i) => a + values[i], 0) / n
    let cov = 0
    let vt = 0
    for (const i of idx) {
      cov += (times[i] - mt) * (values[i] - mv)
      vt += (times[i] - mt) ** 2
    }
    const slope = vt > 0 ? cov / vt : 0
    for (const i of idx) out[i] = values[i] - (mv + slope * (times[i] - mt))
  }
  return out
}
const ALPHA = 0.05

function autocorr(v, lag) {
  const n = v.length
  const m = v.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    den += (v[i] - m) ** 2
    if (i + lag < n) num += (v[i] - m) * (v[i + lag] - m)
  }
  return den > 0 ? num / den : 0
}

/** Pyper & Peterman (1998) etkin örneklem büyüklüğü: 1/n_eff = 1/n + (2/n) Σ ((n−j)/n) ρx(j) ρy(j), j ≤ n/5. */
export function effectiveSampleSize(xs, ys) {
  const n = xs.length
  let sum = 0
  for (let j = 1; j <= Math.floor(n / 5); j++) sum += ((n - j) / n) * autocorr(xs, j) * autocorr(ys, j)
  const inv = 1 / n + (2 / n) * sum
  return inv > 0 ? Math.min(n, 1 / inv) : n
}

const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`
const prevYearKey = (k) => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`
const shiftMonths = (k, d) => {
  const t = Number(k.slice(0, 4)) * 12 + (Number(k.slice(5)) - 1) + d
  return key(Math.floor(t / 12), (t % 12) + 1)
}

/** Aylık seri (Map 'YYYY-MM' → değer) → geçen yılın aynı ayına göre log değişim (Map). */
export function yoyLogChanges(series) {
  const out = new Map()
  for (const [k, v] of series) {
    const base = series.get(prevYearKey(k))
    if (v > 0 && base > 0) out.set(k, Math.log(v / base))
  }
  return out
}

/**
 * Saf hesap: okunma ve turist aylık serileri → en güçlü gecikmedeki korelasyon. Yeterli ortak ay yoksa
 * { r: null, n } döner.
 */
export function readingTourismCorrelation(reading, tourists) {
  const ry = yoyLogChanges(reading)
  const ty = yoyLogChanges(tourists)
  const usable = (k) => !EXCLUDED_YEARS.has(Number(k.slice(0, 4)))
  let best = null
  let maxN = 0
  for (let lag = 0; lag <= MAX_LAG_MONTHS; lag++) {
    const xs = []
    const ys = []
    const periods = []
    const times = []
    for (const [k, t] of ty) {
      const rk = shiftMonths(k, -lag)
      if (!usable(k) || !usable(rk) || !ry.has(rk)) continue
      xs.push(ry.get(rk))
      ys.push(t)
      periods.push(periodOf(k))
      times.push(Number(k.slice(0, 4)) * 12 + Number(k.slice(5)))
    }
    maxN = Math.max(maxN, xs.length)
    if (xs.length < MIN_PAIRS) continue
    const dx = detrendByPeriod(xs, periods, times)
    const dy = detrendByPeriod(ys, periods, times)
    const r = pearsonCorrelation(dx, dy)
    if (!Number.isFinite(r)) continue
    if (!best || Math.abs(r) > Math.abs(best.r))
      best = { r, lagMonths: lag, n: xs.length, nEff: effectiveSampleSize(dx, dy) }
  }
  if (!best) return { r: null, n: maxN }
  // Anlamlılık etkin örneklemle (en az 4); rapor edilen n gerçek ay sayısıdır.
  const p = pValueForPearsonR(best.r, Math.max(4, Math.floor(best.nEff)))
  const pAdjusted = p == null ? null : Math.min(1, p * (MAX_LAG_MONTHS + 1))
  return {
    r: Math.round(best.r * 100) / 100,
    lagMonths: best.lagMonths,
    n: best.n,
    nEff: Math.round(best.nEff),
    pAdjusted: pAdjusted == null ? null : Math.round(pAdjusted * 1000) / 1000,
    significant: pAdjusted != null && pAdjusted < ALPHA,
  }
}

/** Ülkeye özgü dillerde aylık toplam okunma (son, kaynakta henüz tamamlanmamış ay hariç). */
export function readingSeriesFor(iso2) {
  const langs = languagesOfCountry(iso2).filter((l) => !l.regional)
  if (!langs.length) return { langs: [], series: new Map() }
  const marks = langs.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT year, month, SUM(views) AS v FROM series_language_interest WHERE lang IN (${marks})
       GROUP BY year, month ORDER BY year, month`
    )
    .all(...langs.map((l) => l.lang))
  const series = new Map(rows.map((r) => [key(r.year, r.month), r.v]))
  // Kaynak bir ayı ay bittikten sonra da yarım verebiliyor: son ay önceki üç ayın ortalamasının %40'ının altındaysa atılır.
  const keys = [...series.keys()]
  if (keys.length >= 4) {
    const last = keys.at(-1)
    const avg = keys.slice(-4, -1).reduce((a, k) => a + series.get(k), 0) / 3
    if (avg > 0 && series.get(last) < 0.4 * avg) series.delete(last)
  }
  return { langs: langs.map((l) => l.lang), series }
}

/**
 * Okunma ilgisi × ziyaretçi sayısı, ülke ülke (readingTourism.js). Kaç ülkede test edildiği ve rastlantıyla
 * beklenen "anlamlı" sayısı da verilir: çok sayıda ülkede test yapıldığında birkaçının tesadüfen anlamlı
 * çıkması beklenir; tek tek sonuçlar bu bağlamda okunmalı.
 */
export function buildReadingTourismOverview({
  iso2s = getTrackedIso2s(),
  seriesFor = readingSeriesFor,
  visitors = getVisitorSeries,
} = {}) {
  const items = []
  let sharedLanguage = 0
  for (const iso2 of iso2s) {
    const { langs, series } = seriesFor(iso2)
    if (!langs.length) {
      sharedLanguage++
      continue
    }
    const t = new Map(visitors(iso2).map((s) => [`${s.year}-${String(s.month).padStart(2, '0')}`, s.visitorCount]))
    const c = readingTourismCorrelation(series, t)
    if (c.r != null) items.push({ iso2, ...c })
  }
  items.sort((a, b) => Number(b.significant) - Number(a.significant) || Math.abs(b.r) - Math.abs(a.r))
  return {
    items,
    tested: items.length,
    significantCount: items.filter((i) => i.significant).length,
    expectedByChance: Math.round(items.length * 0.05 * 10) / 10,
    sharedLanguage,
  }
}
