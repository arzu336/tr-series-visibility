import { getEnrichedVisibility } from '../data-pipeline.js'
import { getPipelineDb } from './pipelineDb.js'
import { isGdeltSupportedCountry } from './gdeltNews.js'
import { getAllOwnRankings } from './charts.js'

// Haftalık basın taraması hedefleri: her ülke için O ÜLKEDE ilgili Türk dizileri — son 52 haftada o ülkenin
// sıralamasına giren diziler (en iyi sıraya göre), kalan yer o ülkede yayında olan en popüler dizilerle dolar.
// Önceden "en popüler 35 dizi × 25 ülke" taranıyordu: çiftlerin çoğu dizinin o ülkede hiç bilinmediği
// eşleşmelerdi ve basın tonu kayıtlarının %58'i "yetersiz veri" çıkıyordu. Türkiye (kaynak ülke) taranmaz.

// Google Haberler sorgusu ücretli (SerpApi kotası): ülke başına 2 dizi (2026-10-07; GDELT döneminde 4'tü).
export const SERIES_PER_COUNTRY = 2
// Yayın kataloğu olmayan ülkeler (yalnızca arama ilgisi ya da sınırlı veri): orada yayında olan dizi bilinmediği
// için en popüler diziler taranır; GDELT hız sınırı nedeniyle ülke başına daha az.
export const SERIES_PER_UNCATALOGED_COUNTRY = 2
const STREAM_KEYS = ['flatrate', 'free', 'ads']
const WINDOW_DAYS = 364

function chartedByCountry(conn, today = new Date()) {
  const out = new Map()
  if (!conn) return out
  const from = new Date(today.getTime() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  try {
    const rows = conn
      .prepare(
        `SELECT country_iso2 AS iso2, series_id AS id, MIN(rank) AS best FROM chart_entries
         WHERE period_date >= ? AND series_id IS NOT NULL AND program_kind = 'series'
           AND provider IN ('netflix_tudum', 'flixpatrol')
         GROUP BY country_iso2, series_id`
      )
      .all(from)
    for (const r of rows) {
      if (!out.has(r.iso2)) out.set(r.iso2, [])
      out.get(r.iso2).push(r)
    }
    for (const list of out.values()) list.sort((a, b) => a.best - b.best)
  } catch {
    // tablo yoksa yalnızca yayın varlığıyla seçilir
  }
  return out
}

/**
 * Saf seçim (test edilebilir): ülkeler (önem sırasıyla), katalog, sağlayıcılar, ülke başına sıralama kayıtları →
 * [{ series: { id, name }, countries: [iso2…] }] (dizi başına gruplanmış). `uncataloged`: yayın kataloğu olmayan
 * ülkeler — sıralamaya giren varsa o, yoksa katalogdaki en popüler diziler.
 */
export function selectNewsScanPairs({
  countries,
  series,
  providersById,
  charted,
  perCountry = SERIES_PER_COUNTRY,
  uncataloged = [],
  perUncataloged = SERIES_PER_UNCATALOGED_COUNTRY,
}) {
  const byId = new Map(series.map((s) => [s.id, s]))
  const byPopularity = [...series].sort((a, b) => b.popularity - a.popularity)
  const groups = new Map()
  for (const iso2 of countries) {
    const picked = []
    const add = (id) => {
      if (picked.length < perCountry && byId.has(id) && !picked.includes(id)) picked.push(id)
    }
    for (const r of charted.get(iso2) || []) add(r.id)
    for (const s of byPopularity) {
      if (picked.length >= perCountry) break
      const e = providersById[s.id]?.[iso2]
      if (e && STREAM_KEYS.some((k) => e[k]?.length)) add(s.id)
    }
    for (const id of picked) {
      if (!groups.has(id)) groups.set(id, { series: { id, name: byId.get(id).name }, countries: [] })
      groups.get(id).countries.push(iso2)
    }
  }
  for (const iso2 of uncataloged) {
    const picked = []
    const add = (id) => {
      if (picked.length < perUncataloged && byId.has(id) && !picked.includes(id)) picked.push(id)
    }
    for (const r of charted.get(iso2) || []) add(r.id)
    for (const s of byPopularity) add(s.id)
    for (const id of picked) {
      if (!groups.has(id)) groups.set(id, { series: { id, name: byId.get(id).name }, countries: [] })
      groups.get(id).countries.push(iso2)
    }
  }
  return [...groups.values()].sort((a, b) => b.countries.length - a.countries.length)
}

/**
 * Bir dizinin basın taraması için ülkeleri (saf): önce dizinin sıralamaya girdiği ülkeler (en iyi sıraya göre),
 * kalan yer dizinin izlenebildiği ülkelerle, ülke görünürlüğüne göre. Türkiye ve GDELT/Google'ın tanımadığı yerler
 * (`supported`) çıkarılır.
 */
export function selectSeriesPressCountries({
  seriesId,
  rankings,
  providersForSeries = {},
  countryScores = new Map(),
  limit = 6,
  supported = () => true,
}) {
  const listed = []
  for (const [iso2, own] of rankings) {
    const e = (own.all || []).find((x) => x.seriesId === seriesId)
    if (e) listed.push({ iso2, best: e.bestPosition, weeks: e.weeks })
  }
  listed.sort((a, b) => a.best - b.best || b.weeks - a.weeks)
  const streamable = Object.entries(providersForSeries)
    .filter(([, e]) => STREAM_KEYS.some((k) => e?.[k]?.length))
    .map(([iso2]) => iso2)
    .sort((a, b) => (countryScores.get(b) ?? 0) - (countryScores.get(a) ?? 0))
  const out = []
  for (const iso2 of [...listed.map((l) => l.iso2), ...streamable]) {
    if (out.length >= limit) break
    if (iso2 !== 'TR' && supported(iso2) && !out.includes(iso2)) out.push(iso2)
  }
  return out
}

export async function getSeriesPressCountries(seriesId, { limit = 6 } = {}) {
  const [{ data, raw }, rankings] = await Promise.all([getEnrichedVisibility(), getAllOwnRankings()])
  return selectSeriesPressCountries({
    seriesId,
    rankings,
    providersForSeries: raw.providersById?.[seriesId] || {},
    countryScores: new Map(data.countries.map((c) => [c.iso2, c.score ?? 0])),
    limit,
    supported: isGdeltSupportedCountry,
  })
}

/**
 * Dizi gruplarını dönüşümlü tek listeye çevirir: önce her dizinin en önemli ülkesi, sonra ikincisi… Önceden tarama
 * dizi dizi ilerliyordu; 124 ülkeli ilk dizi saatlerce kuyruğu tutuyor, diğer dizilerin sırası gelmiyordu.
 */
export function interleaveScanPairs(groups) {
  const out = []
  const longest = Math.max(0, ...groups.map((g) => g.countries.length))
  for (let i = 0; i < longest; i++)
    for (const g of groups) if (i < g.countries.length) out.push({ series: g.series, iso2: g.countries[i] })
  return out
}

export async function getNewsScanPairs({ conn = getPipelineDb() } = {}) {
  const { data, raw } = await getEnrichedVisibility()
  const taranabilir = data.countries.filter((c) => c.iso2 !== 'TR' && isGdeltSupportedCountry(c.iso2))
  const countries = taranabilir
    .filter((c) => c.dataSource !== 'proxy')
    .sort((a, b) => b.score - a.score)
    .map((c) => c.iso2)
  const uncataloged = taranabilir
    .filter((c) => c.dataSource === 'proxy')
    .map((c) => c.iso2)
    .sort()
  return selectNewsScanPairs({
    countries,
    uncataloged,
    series: raw.series,
    providersById: raw.providersById,
    charted: chartedByCountry(conn),
  })
}
