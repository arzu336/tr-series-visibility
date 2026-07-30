import { getCached, setCached } from './cache.js'
import { getDuolingoTrend, maybeRecordDuolingoSnapshot } from './duolingo-history.js'

const DUOLINGO_COURSES_URL = 'https://www.duolingo.com/api/1/courses/list'
const RAW_CACHE_KEY = 'duolingo-courses'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 saat — data-pipeline.js'teki aynı TTL

// Duolingo'nun herkese açık kurs listesi ucu (test edildi, gerçek veri döner) — ülke bazlı
// değil, KÜRESEL tek bir "Türkçe öğrenen toplam kullanıcı" sayısı verir (bkz.
// src/components/TurkishLearningIndex.jsx'teki açıkça "🌍 Küresel" etiketli ayrı kart —
// ülke bazlı Google Trends endeksiyle karıştırılmaz). Yunus Emre Enstitüsü eklenmedi:
// resmi sitesi JS ile render ediliyor, basit bir HTTP isteğiyle içeriği alınamıyor.
async function fetchCourses() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached

  const res = await fetch(DUOLINGO_COURSES_URL)
  if (!res.ok) {
    throw new Error(`Duolingo isteği başarısız (${res.status})`)
  }
  const courses = await res.json()
  setCached(RAW_CACHE_KEY, courses, RAW_CACHE_TTL_MS)
  return courses
}

export async function getDuolingoTurkishStats() {
  const courses = await fetchCourses()
  const turkishCourses = courses.filter((c) => c.learning_language === 'tr')
  const totalLearners = turkishCourses.reduce((sum, c) => sum + (c.num_learners || 0), 0)

  const trend = getDuolingoTrend(totalLearners)
  maybeRecordDuolingoSnapshot(totalLearners)

  return {
    status: 'ready',
    totalLearners,
    courseCount: turkishCourses.length,
    trend,
  }
}
