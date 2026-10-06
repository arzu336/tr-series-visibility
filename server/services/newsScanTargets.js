import { getEnrichedVisibility } from '../data-pipeline.js'
import { getPipelineDb } from './pipelineDb.js'
import { isGdeltSupportedCountry } from './gdeltNews.js'

// Haftalık basın taraması hedefleri: her ülke için O ÜLKEDE ilgili Türk dizileri — son 52 haftada o ülkenin
// sıralamasına giren diziler (en iyi sıraya göre), kalan yer o ülkede yayında olan en popüler dizilerle dolar.
// Önceden "en popüler 35 dizi × 25 ülke" taranıyordu: çiftlerin çoğu dizinin o ülkede hiç bilinmediği
// eşleşmelerdi ve basın tonu kayıtlarının %58'i "yetersiz veri" çıkıyordu. Türkiye (kaynak ülke) taranmaz.

export const SERIES_PER_COUNTRY = 4
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
