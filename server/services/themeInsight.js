import crypto from 'node:crypto'
import { getRawSeriesDataCached } from '../data-pipeline.js'
import { ensureClassified } from '../themes.js'
import { getGlobalThemeDistribution } from '../aggregate.js'
import { generateThemeInsight } from '../llm.js'
import { getCached, setCached } from '../cache.js'

const INSIGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function distributionHash(distribution) {
  const summary = distribution.map((d) => `${d.theme}:${d.seriesCount}:${d.countriesReached}`).join('|')
  return crypto.createHash('sha1').update(summary).digest('hex').slice(0, 16)
}

// Tema Bazlı AI Yorumu: dağılım (raw.series + themeStore'dan, ucuz/hep hesaplanır) + LLM
// yorumu (server/llm.js, pahalı/önbelleklenir) birlikte döner. Dağılım aynı kaldığı sürece
// (aynı hash) LLM tekrar çağrılmaz — 200 dizinin teması sık değişmediği için bu neredeyse hep
// önbellekten döner. LLM başarısız olursa (kota, timeout — bkz. llm.js retry) dağılım YİNE DE
// döner, insightText null + honest bir "üretilemedi" durumuyla; sayısal veri LLM'e bağımlı değil.
export async function getThemeInsight() {
  const raw = await getRawSeriesDataCached()
  const themeStore = await ensureClassified(raw.series)
  const distribution = getGlobalThemeDistribution(raw, themeStore)

  const hash = distributionHash(distribution)
  const cacheKey = `theme-insight:${hash}`
  const cached = getCached(cacheKey)
  if (cached) {
    return { distribution, insightText: cached.insightText, generatedAt: cached.generatedAt, fromCache: true }
  }

  let insightText = null
  let generatedAt = new Date().toISOString()
  try {
    insightText = await generateThemeInsight(distribution)
    setCached(cacheKey, { insightText, generatedAt }, INSIGHT_CACHE_TTL_MS)
  } catch (err) {
    console.error('[theme-insight] LLM yorumu üretilemedi:', err.message)
  }

  return { distribution, insightText, generatedAt, fromCache: false }
}
