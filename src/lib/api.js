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

// `cachedOnly`: yalnızca kayıtlı sonuç (ücretli sorgu yok); kayıt yoksa { notCached: true }.
const cachedQ = (cachedOnly, sep = '?') => (cachedOnly ? `${sep}cached=1` : '')

export async function fetchTrends(seriesName, { cachedOnly = false } = {}) {
  return handle(await fetch(`/api/trends/${encodeURIComponent(seriesName)}${cachedQ(cachedOnly)}`))
}

export async function fetchSocialListening(seriesName, { cachedOnly = false } = {}) {
  return handle(await fetch(`/api/social/${encodeURIComponent(seriesName)}${cachedQ(cachedOnly)}`))
}

export async function fetchShareOfSearch(titles) {
  return handle(await fetch(`/api/trends/share-of-search?titles=${encodeURIComponent(titles.join(','))}`))
}

export async function fetchRegionalBreakdown(titles) {
  return handle(await fetch(`/api/trends/regional-breakdown?titles=${encodeURIComponent(titles.join(','))}`))
}

export async function fetchTrendsTimeSeries(seriesName, iso2 = null, { cachedOnly = false } = {}) {
  const q = iso2 ? `?geo=${encodeURIComponent(iso2)}` : ''
  return handle(
    await fetch(`/api/trends/timeseries/${encodeURIComponent(seriesName)}${q}${cachedQ(cachedOnly, q ? '&' : '?')}`)
  )
}

export async function fetchTrendsInsight(seriesName, iso2 = null, { cachedOnly = false } = {}) {
  const q = iso2 ? `?geo=${encodeURIComponent(iso2)}` : ''
  return handle(
    await fetch(`/api/trends/insight/${encodeURIComponent(seriesName)}${q}${cachedQ(cachedOnly, q ? '&' : '?')}`)
  )
}

// 202 döner: { job, existing, statusUrl }. Sonuç için fetchJob ile ilerleme izlenir.
export async function enrichSeriesNow(seriesId) {
  return handle(await fetch(`/api/series/enrich-now/${seriesId}`, { method: 'POST' }))
}

/** Dizinin süren (ya da son 30 dk'da biten) basın+sosyal tarama işi; yoksa { job: null }. */
export async function fetchSeriesEnrichJob(seriesId) {
  return handle(await fetch(`/api/series/${encodeURIComponent(seriesId)}/enrich-job`))
}

// YouTube bağlantıları (yönetici)
export async function fetchYoutubeStatus() {
  return handle(await fetch('/api/youtube/status'))
}

export async function runYoutubePublic() {
  return handle(await fetch('/api/youtube/public/run', { method: 'POST' }))
}

export async function fetchSeriesYoutube(seriesId) {
  return handle(await fetch(`/api/series/${encodeURIComponent(seriesId)}/youtube`))
}

export async function syncYoutubeChannel(channelId) {
  return handle(await fetch(`/api/youtube/channels/${encodeURIComponent(channelId)}/sync`, { method: 'POST' }))
}

export async function disconnectYoutubeChannel(channelId) {
  return handle(await fetch(`/api/youtube/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' }))
}

export async function fetchCountryContext(iso2) {
  return handle(await fetch(`/api/country/${encodeURIComponent(iso2)}/context`))
}

// Televizyon yayınları ve dağıtımcı satış kayıtları
export async function fetchCountryTv(iso2) {
  return handle(await fetch(`/api/country/${encodeURIComponent(iso2)}/tv`))
}

export async function fetchSeriesTv(seriesId) {
  return handle(await fetch(`/api/series/${encodeURIComponent(seriesId)}/tv`))
}

export async function fetchTvAdmin() {
  return handle(await fetch('/api/admin/tv'))
}

export async function runTvGuide() {
  return handle(await fetch('/api/admin/tv/run', { method: 'POST' }))
}

const postJson = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function mapTvTitle(body) {
  return handle(await postJson('/api/admin/tv/map', body))
}

export async function importSalesCsv(body) {
  return handle(await postJson('/api/admin/tv/sales', body))
}

export async function fetchJob(jobId) {
  return handle(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`))
}

/** İş bitene kadar (done/failed) yoklar; her yoklamada onProgress(job) çağrılır. */
export async function waitForJob(jobId, { intervalMs = 4000, onProgress, signal } = {}) {
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

export async function fetchSeriesCast(tmdbId) {
  return handle(await fetch(`/api/series/${tmdbId}/cast`))
}

export async function fetchMagazineNews(tmdbId) {
  return handle(await fetch(`/api/series/${tmdbId}/magazine`))
}

export async function fetchMagazinePreview(url) {
  return handle(await fetch(`/api/magazine/preview?url=${encodeURIComponent(url)}`))
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

/** Ülke raporu — üç profil (executive | marketing | producer); yetki sunucuda denetlenir (403). */
export async function fetchGlobalReport({ fresh = false } = {}) {
  return handle(await fetch(`/api/report/global${fresh ? '?fresh=1' : ''}`))
}

export async function fetchSeriesReport(seriesId, { fresh = false } = {}) {
  const q = fresh ? '?fresh=1' : ''
  return handle(await fetch(`/api/report/series/${encodeURIComponent(seriesId)}${q}`))
}

export async function fetchCountryReport(iso2, { fresh = false } = {}) {
  const q = fresh ? '?fresh=1' : ''
  return handle(await fetch(`/api/report/country/${encodeURIComponent(iso2)}${q}`))
}

/** Liste uçları (chart_entries): kaynak etiketiyle döner. */
export async function fetchChartsMeta() {
  return handle(await fetch('/api/charts/meta'))
}

export async function fetchGlobalTop(week) {
  const q = week ? `?week=${encodeURIComponent(week)}` : ''
  return handle(await fetch(`/api/charts/global${q}`))
}

export async function fetchTurkeyTv({ date, segment = 'Total', onlySeries = true } = {}) {
  const q = new URLSearchParams({ segment, onlySeries: onlySeries ? '1' : '0' })
  if (date) q.set('date', date)
  return handle(await fetch(`/api/charts/turkey-tv?${q}`))
}

export async function fetchCountryCharts(iso2, { week, range = 'monthly' } = {}) {
  const q = new URLSearchParams({ range })
  if (week) q.set('week', week)
  return handle(await fetch(`/api/charts/country/${encodeURIComponent(iso2)}?${q}`))
}

export async function fetchContinentCharts() {
  return handle(await fetch('/api/charts/continents'))
}

export async function fetchSeriesCharts(tmdbId) {
  return handle(await fetch(`/api/charts/series/${encodeURIComponent(tmdbId)}`))
}
