import {
  getExportSeries,
  getRelatedSeries,
  getSectorYoy,
  getExportIso2s,
  RELATED_SECTORS,
  SECTOR_TOTAL,
  COUNTRY_ALL,
} from './exportsData.js'
import { readingSeriesFor, readingTourismCorrelation, MIN_PAIRS } from './readingTourism.js'
import { differenceInDifferences } from './tourismCorrelation.js'
import { rankControlCountries } from '../control-matching.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }
import { buildImpactChart, readImpactInsight, exportFacts, seriesExportFacts } from './impactInsight.js'

// İhracat etkisi (2026-10-16): dizilerin izlendiği ülkelerde Türkiye'nin ihracatı — özellikle dizilerle
// ilişkilendirilebilecek tüketim sektörleri (hazır giyim, tekstil, deri, halı, mobilya, mücevher, gıda) — nasıl
// değişti? Turizm etkisiyle aynı üç bakış: (1) son ayın geçen yıla göre değişimi, Türkiye geneliyle kıyaslı,
// (2) okunma ilgisi × ilişkili sektör ihracatı korelasyonu (yıllık değişim, gecikmeli), (3) benzer ülkelere göre
// fark (DiD). Korelasyon nedensellik değildir; cümleler yalnızca hesaplanan maddelerden kurulur.

const RELATED_SET = new Set(RELATED_SECTORS)
const SECTORS_SHOWN = 6
const KONTROL_ADAY = 15
const MAX_KONTROL = 5
const yetersiz = (reason) => ({ status: 'hesaplanamaz', reason })
const OK = (value, extra = {}) => ({ status: 'hesaplandi', value, ...extra })
const r1 = (n) => Math.round(n * 10) / 10
const num = (n) => typeof n === 'number' && Number.isFinite(n)
const pct = (cur, prev) => (num(cur) && num(prev) && prev > 0 ? r1(((cur - prev) / prev) * 100) : null)
const ay2 = (m) => String(m).padStart(2, '0')
export const nameOf = (iso2) => countryNames[iso2]?.name || iso2

/** Son ay: toplam ve ilişkili sektör ihracatı, geçen yıla göre; Türkiye geneli aynı ay. Saf. */
export function buildLatestExports(countryYoy, turkeyYoy) {
  if (!countryYoy?.rows?.length) return null
  const sum = (rows, filter) =>
    rows.filter(filter).reduce(
      (a, r) => ({
        cur: a.cur + (r.cur || 0),
        prev: a.prev + (num(r.prev) ? r.prev : 0),
        hasPrev: a.hasPrev && num(r.prev),
      }),
      { cur: 0, prev: 0, hasPrev: true }
    )
  const total = countryYoy.rows.find((r) => r.sector === SECTOR_TOTAL)
  const related = sum(countryYoy.rows, (r) => RELATED_SET.has(r.sector))
  const tTotal = turkeyYoy?.rows?.find((r) => r.sector === SECTOR_TOTAL)
  const tRelated = turkeyYoy ? sum(turkeyYoy.rows, (r) => RELATED_SET.has(r.sector)) : null
  const turkeyByS = new Map((turkeyYoy?.rows || []).map((r) => [r.sector, r]))
  const sectors = countryYoy.rows
    .filter((r) => RELATED_SET.has(r.sector) && r.cur > 0)
    .sort((a, b) => b.cur - a.cur)
    .slice(0, SECTORS_SHOWN)
    .map((r) => ({
      sector: r.sector,
      usd: Math.round(r.cur),
      changePct: pct(r.cur, r.prev),
      turkeyChangePct: pct(turkeyByS.get(r.sector)?.cur, turkeyByS.get(r.sector)?.prev),
    }))
  return {
    year: countryYoy.year,
    month: countryYoy.month,
    totalUsd: total ? Math.round(total.cur) : null,
    totalChangePct: total ? pct(total.cur, total.prev) : null,
    relatedUsd: Math.round(related.cur),
    relatedChangePct: related.hasPrev ? pct(related.cur, related.prev) : null,
    relatedShare: total && total.cur > 0 ? r1((related.cur / total.cur) * 100) : null,
    turkeyTotalChangePct: tTotal ? pct(tTotal.cur, tTotal.prev) : null,
    turkeyRelatedChangePct: tRelated && tRelated.hasPrev ? pct(tRelated.cur, tRelated.prev) : null,
    sectors,
  }
}

/** Okunma ilgisi × ilişkili sektör ihracatı (aylık, yıllık değişim, 0–6 ay gecikme). Saf. */
export function buildExportCorrelation(reading, relatedSeries) {
  if (!reading.langs.length)
    return yetersiz('ülkenin dili birden çok ülkede konuşuluyor; okunma ilgisi bu ülkeye ayrılamaz')
  const ex = new Map(
    relatedSeries.filter((s) => num(s.usd) && s.usd > 0).map((s) => [`${s.year}-${ay2(s.month)}`, s.usd])
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

/** Son 12 ayın ilişkili sektör ihracatı, önceki 12 aya göre; kontrol ülkeleriyle fark (yüzde puan). */
export async function buildExportDid(iso2, relatedFor, rankControls) {
  const win = last12Pair(relatedFor(iso2))
  if (!win) return yetersiz('art arda 24 aylık ihracat serisi yok')
  const adaylar = (await rankControls(iso2, new Set([iso2]), KONTROL_ADAY)) || []
  const kontroller = []
  for (const k of adaylar) {
    if (kontroller.length >= MAX_KONTROL) break
    const kw = last12Pair(relatedFor(k.iso2), win.to)
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
 * Ülke brifingi bölümü. `deps` test için: getSectorYoy, getRelatedSeries, readingSeriesFor, rankControlCountries.
 */
export async function buildExportSignal(iso2, deps = {}) {
  const {
    getSectorYoy: yoyAl = getSectorYoy,
    getRelatedSeries: iliskiliAl = getRelatedSeries,
    readingSeriesFor: okumaAl = readingSeriesFor,
    rankControlCountries: kontrol = rankControlCountries,
  } = deps
  const latest = buildLatestExports(yoyAl(iso2), yoyAl(COUNTRY_ALL))
  if (!latest) return yetersiz('bu ülke için ihracat kaydı yok')
  const correlation = buildExportCorrelation(okumaAl(iso2), iliskiliAl(iso2))
  let didEstimate
  try {
    didEstimate = await buildExportDid(iso2, iliskiliAl, kontrol)
  } catch (err) {
    didEstimate = yetersiz(`kontrol ülkesi önerisi alınamadı: ${err.message}`)
  }
  const okuma = okumaAl(iso2).series
  const chart = buildImpactChart(
    iliskiliAl(iso2).map((r) => ({ year: r.year, month: r.month, value: r.usd })),
    okuma
  )
  const data = { latest, correlation, didEstimate, chart }
  data.insight = readImpactInsight('export', iso2, exportFacts(nameOf(iso2), data))
  return { status: 'hesaplandi', data }
}

/**
 * Dizi raporu bölümü: dizinin satıldığı/listelere girdiği ülkelerde ilişkili sektör ihracatının son aydaki
 * yıllık değişimi; ortalaması Türkiye geneliyle kıyaslanır. `iso2s`: dizinin pazarları.
 */
export function buildSeriesExports(iso2s, deps = {}) {
  const { getSectorYoy: yoyAl = getSectorYoy, getExportIso2s: hepsi = getExportIso2s } = deps
  const have = hepsi()
  const turkey = yoyAl(COUNTRY_ALL)
  const countries = []
  for (const iso2 of new Set(iso2s)) {
    if (iso2 === 'TR' || !have.has(iso2)) continue
    const l = buildLatestExports(yoyAl(iso2), turkey)
    if (!l || l.relatedChangePct == null) continue
    countries.push({
      iso2,
      name: nameOf(iso2),
      year: l.year,
      month: l.month,
      relatedUsd: l.relatedUsd,
      relatedChangePct: l.relatedChangePct,
      totalChangePct: l.totalChangePct,
    })
  }
  if (!countries.length) return null
  countries.sort((a, b) => b.relatedUsd - a.relatedUsd)
  const ref = buildLatestExports(turkey, null)
  const data = {
    year: countries[0].year,
    month: countries[0].month,
    countries,
    avgRelatedChangePct: r1(countries.reduce((t, c) => t + c.relatedChangePct, 0) / countries.length),
    turkeyRelatedChangePct: ref?.relatedChangePct ?? null,
  }
  if (deps.seriesId != null && deps.seriesName)
    data.insight = readImpactInsight('seriesExport', deps.seriesId, seriesExportFacts(deps.seriesName, data))
  return data
}

export { getExportSeries }
