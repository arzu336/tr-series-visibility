import { getCached, setCached } from './cache.js'
import { getDuolingoTrend, maybeRecordDuolingoSnapshot } from './duolingo-history.js'

const EXTERNAL_TIMEOUT_MS = 15000

const DUOLINGO_COURSES_URL = 'https://www.duolingo.com/api/1/courses/list'
const RAW_CACHE_KEY = 'duolingo-courses'
const RAW_CACHE_TTL_MS = 24 * 60 * 60 * 1000

async function fetchCourses() {
  const cached = getCached(RAW_CACHE_KEY)
  if (cached) return cached

  const res = await fetch(DUOLINGO_COURSES_URL, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`Veri isteği başarısız (${res.status})`)
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
