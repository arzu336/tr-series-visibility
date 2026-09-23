import crypto from 'node:crypto'
import { generateSeriesTrendInsight } from '../llm.js'
import { getCached, setCached } from '../cache.js'

const INSIGHT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function round1(n) {
  return Math.round(n * 10) / 10
}

function getWeekNumber(tsSeconds) {
  const date = new Date(tsSeconds * 1000)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const week1 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

function summarizeTimeline(timeline) {
  const values = timeline.map((p) => p.value)
  const peakIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
  const average = round1(values.reduce((sum, v) => sum + v, 0) / values.length)
  const startValue = values[0]
  const endValue = values[values.length - 1]
  const direction = endValue > startValue * 1.15 ? 'yükseliş' : endValue < startValue * 0.85 ? 'düşüş' : 'yatay seyir'
  return {
    peakWeek: getWeekNumber(timeline[peakIdx].timestamp),
    peakValue: timeline[peakIdx].value,
    startValue,
    endValue,
    average,
    direction,
  }
}

function timelineHash(timeline) {
  const summary = timeline.map((p) => `${p.timestamp}:${p.value}`).join('|')
  return crypto.createHash('sha1').update(summary).digest('hex').slice(0, 16)
}

export async function getSeriesTrendInsight(seriesName, timeline, scopeLabel = null) {
  if (!timeline || timeline.length < 2) {
    return { stats: null, insightText: null, generatedAt: null, fromCache: false }
  }

  const stats = summarizeTimeline(timeline)
  const cacheKey = `series-trend-insight:${scopeLabel ? `${scopeLabel}:` : ''}${timelineHash(timeline)}`
  const cached = getCached(cacheKey)
  if (cached) {
    return { stats, insightText: cached.insightText, generatedAt: cached.generatedAt, fromCache: true }
  }

  let insightText = null
  const generatedAt = new Date().toISOString()
  try {
    insightText = await generateSeriesTrendInsight(seriesName, stats, scopeLabel)
    setCached(cacheKey, { insightText, generatedAt }, INSIGHT_CACHE_TTL_MS)
  } catch (err) {
    console.error(`[seriesTrendInsight] "${seriesName}" için LLM yorumu üretilemedi:`, err.message)
  }

  return { stats, insightText, generatedAt, fromCache: false }
}
