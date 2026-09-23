let unauthorizedHandler = null

/** App.jsx mount'ta bir kez kaydeder; oturum düştüğünde çağrılır. */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

async function handle(res, { isLoginAttempt = false } = {}) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 401 && !isLoginAttempt) {
      const serverMessage = body.error
      const notice =
        !serverMessage || serverMessage === 'Giriş gerekli'
          ? 'Oturumunuz sona erdi, lütfen tekrar giriş yapın.'
          : serverMessage
      const err = new Error(serverMessage || notice)
      err.status = 401
      unauthorizedHandler?.(notice)
      throw err
    }
    throw new Error(body.error || `İstek başarısız (${res.status})`)
  }
  return res.json()
}

export async function fetchVisibility() {
  return handle(await fetch('/api/visibility'))
}

export async function fetchThemes() {
  return handle(await fetch('/api/themes'))
}

export async function fetchTaxonomy() {
  return handle(await fetch('/api/taxonomy'))
}

export async function submitThemeOverride(seriesId, theme) {
  return handle(
    await fetch(`/api/themes/${seriesId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    })
  )
}

export async function clearThemeOverride(seriesId) {
  return handle(await fetch(`/api/themes/${seriesId}/clear-override`, { method: 'POST' }))
}

export async function fetchTrendSeriesList() {
  return handle(await fetch('/api/trends/series'))
}

export async function fetchTrends(seriesName) {
  return handle(await fetch(`/api/trends/${encodeURIComponent(seriesName)}`))
}

export async function fetchSocialListening(seriesName) {
  return handle(await fetch(`/api/social/${encodeURIComponent(seriesName)}`))
}

export async function fetchShareOfSearch(titles) {
  return handle(await fetch(`/api/trends/share-of-search?titles=${encodeURIComponent(titles.join(','))}`))
}

export async function fetchRegionalBreakdown(titles) {
  return handle(await fetch(`/api/trends/regional-breakdown?titles=${encodeURIComponent(titles.join(','))}`))
}

export async function fetchTrendsTimeSeries(seriesName, iso2 = null) {
  const q = iso2 ? `?geo=${encodeURIComponent(iso2)}` : ''
  return handle(await fetch(`/api/trends/timeseries/${encodeURIComponent(seriesName)}${q}`))
}

export async function fetchTrendsInsight(seriesName, iso2 = null) {
  const q = iso2 ? `?geo=${encodeURIComponent(iso2)}` : ''
  return handle(await fetch(`/api/trends/insight/${encodeURIComponent(seriesName)}${q}`))
}

// 202 döner: { job, existing, statusUrl }. Sonuç için fetchJob ile ilerleme izlenir.
export async function enrichSeriesNow(seriesId) {
  return handle(await fetch(`/api/series/enrich-now/${seriesId}`, { method: 'POST' }))
}

export async function fetchJob(jobId) {
  return handle(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`))
}

/** İş bitene kadar (done/failed) yoklar; her yoklamada onProgress(job) çağrılır. */
export async function waitForJob(jobId, { intervalMs = 2000, onProgress, signal } = {}) {
  for (;;) {
    if (signal?.aborted) throw new Error('İzleme iptal edildi')
    const job = await fetchJob(jobId)
    onProgress?.(job)
    if (job.status === 'done') return job.result
    if (job.status === 'failed') throw new Error(job.error || 'İş başarısız oldu')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export async function fetchImdbData(tmdbSeriesId) {
  return handle(await fetch(`/api/imdb/${tmdbSeriesId}`))
}

export async function fetchSeriesEnrichment(tmdbSeriesId) {
  return handle(await fetch(`/api/series-enrichment/${tmdbSeriesId}`))
}

export async function fetchPersonImpact(personId) {
  return handle(await fetch(`/api/person/${personId}`))
}

export async function fetchCulturalImpact() {
  return handle(await fetch('/api/impact/cultural'))
}

export async function fetchTourismImpact() {
  return handle(await fetch('/api/impact/tourism'))
}

export async function fetchExportImpact() {
  return handle(await fetch('/api/impact/export'))
}

export async function fetchCountrySummary(iso2, { withInsight = false } = {}) {
  const q = withInsight ? '?insight=1' : ''
  return handle(await fetch(`/api/impact/country-summary/${encodeURIComponent(iso2)}${q}`))
}

export async function fetchBenchmark() {
  return handle(await fetch('/api/benchmark'))
}

export async function fetchTurkishLearningIndex() {
  return handle(await fetch('/api/turkish-learning-index'))
}

export async function fetchRegionalInterest(seriesName, iso2) {
  return handle(await fetch(`/api/regional-interest/${encodeURIComponent(seriesName)}/${iso2}`))
}

export async function fetchDuolingoStats() {
  return handle(await fetch('/api/duolingo-stats'))
}

export async function fetchSeriesPopularity(range = 'monthly') {
  return handle(await fetch(`/api/series-popularity?range=${range}`))
}

export async function fetchMediaSentiment(seriesId, iso2) {
  return handle(await fetch(`/api/media-sentiment/${seriesId}/${iso2}`))
}

export async function fetchMediaSentimentSummary(seriesId) {
  return handle(await fetch(`/api/media-sentiment-summary/${seriesId}`))
}

export async function fetchSeriesMeta(tmdbId) {
  return handle(await fetch(`/api/series/${tmdbId}`))
}

export async function fetchCountryLeaderboard(iso2) {
  return handle(await fetch(`/api/country-leaderboard/${iso2}`))
}

export async function fetchAuthStatus() {
  return handle(await fetch('/api/auth/status'))
}

export async function login(email, password) {
  return handle(
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    { isLoginAttempt: true }
  )
}

export async function register({ name, email, role, password }) {
  return handle(
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role, password }),
    })
  )
}

export async function logout() {
  return handle(await fetch('/api/auth/logout', { method: 'POST' }))
}

export async function fetchAdminUsers() {
  return handle(await fetch('/api/admin/users'))
}

export async function approveUser(id) {
  return handle(await fetch(`/api/admin/users/${id}/approve`, { method: 'POST' }))
}

export async function rejectUser(id) {
  return handle(await fetch(`/api/admin/users/${id}/reject`, { method: 'POST' }))
}

export async function setAccessLevel(id, accessLevel) {
  return handle(
    await fetch(`/api/admin/users/${id}/access-level`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessLevel }),
    })
  )
}

export async function resetUserPassword(id) {
  return handle(await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' }))
}

export async function deleteUser(id) {
  return handle(await fetch(`/api/admin/users/${id}/delete`, { method: 'POST' }))
}

export async function changePassword(currentPassword, newPassword) {
  return handle(
    await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  )
}

export async function fetchGlobalPeriods(range = 'monthly') {
  return handle(await fetch(`/api/history/global-periods?range=${range}`))
}

export async function fetchCountryPeriods(iso2, range = 'monthly') {
  return handle(await fetch(`/api/history/${iso2}/periods?range=${range}`))
}

export async function fetchThemeInsight() {
  return handle(await fetch('/api/theme-insight'))
}

export async function fetchTourismSummary() {
  return handle(await fetch('/api/tourism-summary'))
}

export async function fetchDestinationTaxonomy() {
  return handle(await fetch('/api/destinations/taxonomy'))
}

export async function fetchDestinations() {
  return handle(await fetch('/api/destinations'))
}

export async function submitDestinationOverride(seriesId, destinationIds) {
  return handle(
    await fetch(`/api/destinations/${seriesId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationIds }),
    })
  )
}

export async function clearDestinationOverride(seriesId) {
  return handle(await fetch(`/api/destinations/${seriesId}/clear-override`, { method: 'POST' }))
}

export async function fetchMediaSentimentAudit() {
  return handle(await fetch('/api/media-sentiment-audit'))
}

export async function submitMediaSentimentOverride(id, sentiment) {
  return handle(
    await fetch(`/api/media-sentiment-audit/${id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentiment }),
    })
  )
}

export async function clearMediaSentimentOverride(id) {
  return handle(await fetch(`/api/media-sentiment-audit/${id}/clear-override`, { method: 'POST' }))
}
