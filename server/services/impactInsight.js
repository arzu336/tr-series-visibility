import crypto from 'node:crypto'
import { getCached, setCached } from '../cache.js'
import { generateImpactInsight, direktifIceriyorMu } from '../llm.js'
import countryNames from '../../src/data/country-centroids.json' with { type: 'json' }

// Etki yorumu (2026-10-16, kullanıcı onayı): turizm ve ihracat etkisi bölümlerine yapay zekâ yorumu. Modele yalnızca
// hesaplanmış sayılar verilir; çıktı önbelleğe yazılır ve rapor tıklamada model çağırmaz (gece ön doldurma üretir).
// Sayılar değişince (yeni ay) anahtar değişir, yorum yeniden üretilir. Yönerge/direktif içeren ya da kurum adı geçen
// çıktı atılır; bölüm yorum olmadan görünür.

const TTL_MS = 60 * 24 * 60 * 60 * 1000
const VERSION = 'v1'
const CHART_MONTHS = 36
const BRAND_RE =
  /GDELT|Google|TMDB|JustWatch|Wikipedia|Vikipedi|YİGM|IMDb|FlixPatrol|Netflix|SerpA|TİM\b|TUİK|TÜİK|Comtrade|Kültür ve Turizm Bakanlığı|İhracatçı(?:lar)? (?:Meclisi|Birli)/iu

export const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const ay2 = (m) => String(m).padStart(2, '0')
const ok = (x) => x?.status === 'hesaplandi'
const num = (n) => typeof n === 'number' && Number.isFinite(n)
const yuzde = (n) => `%${Math.abs(n).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
const yon = (n) => (n >= 0 ? 'arttı' : 'azaldı')
const periodName = (k) => {
  const [y, m] = String(k).split('-')
  const ad = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][Number(m) - 1]
  return ad ? `${ad} ${y}` : k
}

// ---------------------------------------------------------------------------------------------- grafik verisi

/**
 * Aylık birincil seri (`[{ year, month, value }]`) + okunma haritası (`Map 'YYYY-MM' → okunma`) → son 36 ay.
 * Dönen: [{ key, primary, secondary }]; okunma yoksa secondary null.
 */
export function buildImpactChart(primary, reading = new Map(), months = CHART_MONTHS) {
  const rows = (primary || []).filter((r) => num(r.value)).slice(-months)
  if (rows.length < 6) return null
  return rows.map((r) => {
    const key = `${r.year}-${ay2(r.month)}`
    const s = reading.get(key)
    return { key, primary: r.value, secondary: num(s) ? s : null }
  })
}

// ---------------------------------------------------------------------------------------------- olgular

/** Turizm bölümü verisinden sade olgu satırları (modele giden tek girdi). */
export function tourismFacts(countryName, d) {
  const out = []
  if (ok(d.arrivals))
    out.push(
      `${d.arrivals.latest} ayında ${countryName}'dan Türkiye'ye gelen ziyaretçi: ${d.arrivals.value.toLocaleString('tr-TR')}`
    )
  if (ok(d.correlation))
    out.push(
      `Dizilere okunma ilgisi ile ziyaretçi sayısı ${d.correlation.lagMonths} ay gecikmeyle birlikte değişiyor: korelasyon ${d.correlation.value} (${d.correlation.sampleSize} ay, ${d.correlation.significant ? 'istatistiksel olarak anlamlı' : 'anlamlı değil, rastlantı olabilir'})`
    )
  if (ok(d.didEstimate))
    out.push(
      `${d.didEstimate.window} penceresinde bu ülkeden ziyaretçi ${yuzde(d.didEstimate.treatmentChangePct)} ${yon(d.didEstimate.treatmentChangePct)}; benzer ülkeler (${(d.didEstimate.controls || []).map((c) => nameOf(c.iso2)).join(', ')}) ortalama ${yuzde(d.didEstimate.controlChangePct)} ${yon(d.didEstimate.controlChangePct)}; fark ${d.didEstimate.value} puan`
    )
  if (ok(d.leadingSignal))
    out.push(
      `Diziye yönelik aramalar ile Türkiye'ye seyahat aramaları ${d.leadingSignal.lagWeeks} hafta arayla ${d.leadingSignal.value >= 0 ? 'aynı' : 'ters'} yönde (korelasyon ${d.leadingSignal.value}, keşif amaçlı)`
    )
  return out
}

/** İhracat bölümü verisinden olgu satırları. */
export function exportFacts(countryName, d) {
  const out = []
  const l = d.latest
  if (l) {
    const ay = periodName(`${l.year}-${ay2(l.month)}`)
    if (num(l.totalChangePct))
      out.push(
        `${ay} ayında Türkiye'nin ${countryName}'a ihracatı geçen yılın aynı ayına göre ${yuzde(l.totalChangePct)} ${yon(l.totalChangePct)}${num(l.turkeyTotalChangePct) ? `; Türkiye'nin toplam ihracatı ${yuzde(l.turkeyTotalChangePct)} ${yon(l.turkeyTotalChangePct)}` : ''}`
      )
    if (num(l.relatedChangePct))
      out.push(
        `Dizilerle ilişkilendirilebilen sektörlerde (hazır giyim, tekstil, deri, halı, mobilya, mücevher, gıda) ihracat ${yuzde(l.relatedChangePct)} ${yon(l.relatedChangePct)}${num(l.turkeyRelatedChangePct) ? `; Türkiye geneli bu sektörlerde ${yuzde(l.turkeyRelatedChangePct)} ${yon(l.turkeyRelatedChangePct)}` : ''}${num(l.relatedShare) ? `; bu sektörlerin ülkeye ihracattaki payı ${yuzde(l.relatedShare)}` : ''}`
      )
    for (const s of (l.sectors || []).slice(0, 4))
      if (num(s.changePct))
        out.push(
          `${s.sector}: ${yuzde(s.changePct)} ${yon(s.changePct)}${num(s.turkeyChangePct) ? ` (Türkiye geneli ${yuzde(s.turkeyChangePct)} ${yon(s.turkeyChangePct)})` : ''}`
        )
  }
  if (ok(d.correlation))
    out.push(
      `Dizilere okunma ilgisi ile ilişkili sektör ihracatı ${d.correlation.lagMonths} ay gecikmeyle birlikte değişiyor: korelasyon ${d.correlation.value} (${d.correlation.sampleSize} ay, ${d.correlation.significant ? 'istatistiksel olarak anlamlı' : 'anlamlı değil, rastlantı olabilir'})`
    )
  if (ok(d.didEstimate))
    out.push(
      `${d.didEstimate.window} penceresinde ilişkili sektör ihracatı önceki 12 aya göre ${yuzde(d.didEstimate.treatmentChangePct)} ${yon(d.didEstimate.treatmentChangePct)}; benzer ülkeler (${(d.didEstimate.controls || []).map((c) => nameOf(c.iso2)).join(', ')}) ortalama ${yuzde(d.didEstimate.controlChangePct)} ${yon(d.didEstimate.controlChangePct)}; fark ${d.didEstimate.value} puan`
    )
  return out
}

/** Dizi raporu ihracat bölümü verisinden olgu satırları. */
export function seriesExportFacts(seriesName, d) {
  if (!d?.countries?.length) return []
  const ay = periodName(`${d.year}-${ay2(d.month)}`)
  const out = [
    `${ay} ayında ${seriesName} dizisinin izlendiği ${d.countries.length} ülkede ilişkili sektör ihracatı geçen yıla göre ortalama ${yuzde(d.avgRelatedChangePct)} ${yon(d.avgRelatedChangePct)}${num(d.turkeyRelatedChangePct) ? `; Türkiye geneli ${yuzde(d.turkeyRelatedChangePct)} ${yon(d.turkeyRelatedChangePct)}` : ''}`,
  ]
  for (const c of d.countries.slice(0, 6))
    out.push(
      `${c.name}: ilişkili sektörler ${yuzde(c.relatedChangePct)} ${yon(c.relatedChangePct)}${num(c.totalChangePct) ? `, toplam ihracat ${yuzde(c.totalChangePct)} ${yon(c.totalChangePct)}` : ''}`
    )
  return out
}

// ---------------------------------------------------------------------------------------------- önbellek

export function insightKey(kind, id, facts) {
  const hash = crypto.createHash('sha1').update(facts.join('\n')).digest('hex').slice(0, 16)
  return `impact-insight:${VERSION}:${kind}:${id}:${hash}`
}

/** Kayıtlı yorum; yoksa null (rapor tıklamada model çağırmaz). */
export function readImpactInsight(kind, id, facts) {
  if (!facts.length) return null
  const v = getCached(insightKey(kind, id, facts))
  return typeof v === 'string' && v ? v : null
}

/** Yorum yoksa üretir ve kaydeder; süzgeçten geçmeyen çıktı için boş kayıt yazar (bir daha denenmesin). */
export async function ensureImpactInsight(kind, id, subject, facts, { generate = generateImpactInsight } = {}) {
  if (!facts.length) return null
  const key = insightKey(kind, id, facts)
  const cached = getCached(key)
  if (cached != null) return cached || null
  let text = null
  try {
    text = await generate({ kind, subject, facts })
  } catch (err) {
    console.error(`[impactInsight] ${kind}/${id} yorum üretilemedi:`, err.message)
    return null // geçici hata: kayıt yazılmaz, sonraki gece yeniden denenir
  }
  const clean = acceptInsight(text)
  setCached(key, clean || '', TTL_MS)
  return clean
}

/** Direktif, kurum adı ya da nedensellik iddiası içeren yorum reddedilir. */
export function acceptInsight(text) {
  const t = String(text || '').trim()
  if (t.length < 20 || t.length > 700) return null
  if (direktifIceriyorMu(t) || BRAND_RE.test(t)) return null
  if (/\b(sayesinde|neden oldu|yol açtı|kanıtlıyor|kanıtı|ispat)\b/iu.test(t)) return null
  return t
}
