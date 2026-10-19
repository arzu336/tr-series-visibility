import {
  getExportSeries,
  getTotalSeries,
  getSectorYoy,
  getExportIso2s,
  SECTOR_TOTAL,
  COUNTRY_ALL,
} from './exportsData.js'
import { readingSeriesFor, readingTourismCorrelation, MIN_PAIRS } from './readingTourism.js'
import { differenceInDifferences } from './tourismCorrelation.js'
import { rankControlCountries } from '../control-matching.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }
import { buildImpactChart, readImpactInsight, exportFacts, seriesExportFacts } from './impactInsight.js'

// İhracat etkisi (2026-10-16; 2026-10-19: sektör ayrımı kaldırıldı, kullanıcı kararı — hangi sektörün diziyle
// ilişkili olduğunu varsaymak keyfi): dizilerin izlendiği ülkelerde Türkiye'nin TOPLAM ihracatı nasıl değişti?
// Turizm etkisiyle aynı üç bakış: (1) son ayın geçen yıla göre değişimi, Türkiye geneliyle kıyaslı, (2) okunma ilgisi ×
// ihracat korelasyonu (yıllık değişim, gecikmeli), (3) benzer ülkelere göre fark (DiD). Korelasyon nedensellik
// değildir; cümleler yalnızca hesaplanan maddelerden kurulur.

const KONTROL_ADAY = 15
const MAX_KONTROL = 5
const yetersiz = (reason) => ({ status: 'hesaplanamaz', reason })
const OK = (value, extra = {}) => ({ status: 'hesaplandi', value, ...extra })
const r1 = (n) => Math.round(n * 10) / 10
const num = (n) => typeof n === 'number' && Number.isFinite(n)
const pct = (cur, prev) => (num(cur) && num(prev) && prev > 0 ? r1(((cur - prev) / prev) * 100) : null)
const ay2 = (m) => String(m).padStart(2, '0')
export const nameOf = (iso2) => countryNames[iso2]?.name || iso2

/** Son ay: toplam ihracat, geçen yıla göre; Türkiye geneli aynı ay. Saf. */
export function buildLatestExports(countryYoy, turkeyYoy) {
  if (!countryYoy?.rows?.length) return null
  const total = countryYoy.rows.find((r) => r.sector === SECTOR_TOTAL)
  const tTotal = turkeyYoy?.rows?.find((r) => r.sector === SECTOR_TOTAL)
  if (!total) return null
  return {
    year: countryYoy.year,
    month: countryYoy.month,
    totalUsd: Math.round(total.cur),
    totalChangePct: pct(total.cur, total.prev),
    turkeyTotalChangePct: tTotal ? pct(tTotal.cur, tTotal.prev) : null,
  }
}

/** Okunma ilgisi × toplam ihracat (aylık, yıllık değişim, 0–6 ay gecikme). Saf. */
export function buildExportCorrelation(reading, exportSeries) {
  if (!reading.langs.length)
    return yetersiz('ülkenin dili birden çok ülkede konuşuluyor; okunma ilgisi bu ülkeye ayrılamaz')
  const ex = new Map(
    exportSeries.filter((s) => num(s.usd) && s.usd > 0).map((s) => [`${s.year}-${ay2(s.month)}`, s.usd])
  )
  const c = readingTourismCorrelation(reading.series, ex)
  if (c.r == null)
    return {
      ...yetersiz(`okunma ve ihracat serilerinde yeterli ortak ay yok (${c.n}/${MIN_PAIRS})`),
      monthsAvailable: c.n,
      monthsRequired: MIN_PAIRS,
    }
  return OK(c.r, {
    lagMonths: c.lagMonths,
    sampleSize: c.n,
    effectiveSampleSize: c.nEff,
    pAdjusted: c.pAdjusted,
    significant: c.significant,
    unit: 'pearson-r',
    method: 'okunma-yillik-degisim',
  })
}

/** Son 12 ayın toplam ihracatı, önceki 12 aya göre; kontrol ülkeleriyle fark (yüzde puan). */
export async function buildExportDid(iso2, seriesFor, rankControls) {
  const win = last12Pair(seriesFor(iso2))
  if (!win) return yetersiz('art arda 24 aylık ihracat serisi yok')
  const adaylar = (await rankControls(iso2, new Set([iso2]), KONTROL_ADAY)) || []
  const kontroller = []
  for (const k of adaylar) {
    if (kontroller.length >= MAX_KONTROL) break
    const kw = last12Pair(seriesFor(k.iso2), win.to)
    if (!kw || kw.before <= 0) continue
    const did = differenceInDifferences({
      treatmentBefore: win.before,
      treatmentAfter: win.after,
      controlBefore: kw.before,
      controlAfter: kw.after,
    })
    if (!num(did.treatmentChangePct) || !num(did.controlChangePct)) continue
    kontroller.push({
      iso2: k.iso2,
      reason: k.reason ?? null,
      changePct: r1(did.controlChangePct),
      tPct: did.treatmentChangePct,
    })
  }
  if (!kontroller.length) return yetersiz('benzer ülkelerin hiçbirinde aynı dönem için ihracat serisi yok')
  const tPct = kontroller[0].tPct
  const cPct = kontroller.reduce((t, k) => t + k.changePct, 0) / kontroller.length
  return OK(r1(tPct - cPct), {
    unit: 'yuzde-puan',
    treatmentChangePct: r1(tPct),
    controlChangePct: r1(cPct),
    controls: kontroller.map(({ iso2: c, reason, changePct }) => ({ iso2: c, reason, changePct })),
    window: `${win.from} → ${win.to}`,
  })
}

/** Seriden son 12 ay ve önceki 12 ay toplamı; `to` verilirse o aya hizalanır ("YYYY-MM"). */
export function last12Pair(series, to = null) {
  const rows = (series || []).filter((s) => num(s.usd))
  if (rows.length < 24) return null
  const key = (s) => `${s.year}-${ay2(s.month)}`
  let end = rows.length - 1
  if (to) {
    end = rows.findIndex((s) => key(s) === to)
    if (end < 23) return null
  }
  const after = rows.slice(end - 11, end + 1)
  const before = rows.slice(end - 23, end - 11)
  // Ay sırası bozuksa (eksik ay) hesaplanmaz
  const contiguous = [...before, ...after].every(
    (s, i, a) => i === 0 || s.year * 12 + s.month === a[i - 1].year * 12 + a[i - 1].month + 1
  )
  if (!contiguous) return null
  const sum = (a) => a.reduce((t, s) => t + s.usd, 0)
  return { before: sum(before), after: sum(after), from: key(after[0]), to: key(after[after.length - 1]) }
}

/**
 * Ülke brifingi bölümü. `deps` test için: getSectorYoy, getTotalSeries, readingSeriesFor, rankControlCountries.
 */
export async function buildExportSignal(iso2, deps = {}) {
  const {
    getSectorYoy: yoyAl = getSectorYoy,
    getTotalSeries: toplamAl = getTotalSeries,
    readingSeriesFor: okumaAl = readingSeriesFor,
    rankControlCountries: kontrol = rankControlCountries,
  } = deps
  const latest = buildLatestExports(yoyAl(iso2), yoyAl(COUNTRY_ALL))
  if (!latest) return yetersiz('bu ülke için ihracat kaydı yok')
  const correlation = buildExportCorrelation(okumaAl(iso2), toplamAl(iso2))
  let didEstimate
  try {
    didEstimate = await buildExportDid(iso2, toplamAl, kontrol)
  } catch (err) {
    didEstimate = yetersiz(`kontrol ülkesi önerisi alınamadı: ${err.message}`)
  }
  const okuma = okumaAl(iso2).series
  const chart = buildImpactChart(
    toplamAl(iso2).map((r) => ({ year: r.year, month: r.month, value: r.usd })),
    okuma
  )
  const data = { latest, correlation, didEstimate, chart }
  data.insight = readImpactInsight('export', iso2, exportFacts(nameOf(iso2), data))
  return { status: 'hesaplandi', data }
}

/**
 * Dizi raporu bölümü: dizinin satıldığı/listelere girdiği ülkelerde Türkiye'nin toplam ihracatının son aydaki yıllık
 * değişimi; ortalaması Türkiye geneliyle kıyaslanır. `iso2s`: dizinin pazarları.
 */
export function buildSeriesExports(iso2s, deps = {}) {
  const { getSectorYoy: yoyAl = getSectorYoy, getExportIso2s: hepsi = getExportIso2s } = deps
  const have = hepsi()
  const turkey = yoyAl(COUNTRY_ALL)
  const countries = []
  for (const iso2 of new Set(iso2s)) {
    if (iso2 === 'TR' || !have.has(iso2)) continue
    const l = buildLatestExports(yoyAl(iso2), turkey)
    if (!l || l.totalChangePct == null) continue
    countries.push({
      iso2,
      name: nameOf(iso2),
      year: l.year,
      month: l.month,
      totalChangePct: l.totalChangePct,
    })
  }
  if (!countries.length) return null
  countries.sort((a, b) => b.totalChangePct - a.totalChangePct)
  const ref = buildLatestExports(turkey, null)
  const data = {
    year: countries[0].year,
    month: countries[0].month,
    countries,
    avgChangePct: r1(countries.reduce((t, c) => t + c.totalChangePct, 0) / countries.length),
    turkeyChangePct: ref?.totalChangePct ?? null,
  }
  if (deps.seriesId != null && deps.seriesName)
    data.insight = readImpactInsight('seriesExport', deps.seriesId, seriesExportFacts(deps.seriesName, data))
  return data
}

export { getExportSeries }
