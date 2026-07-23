async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
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

export async function submitThemeOverride(seriesId, theme, reviewer) {
  return handle(
    await fetch(`/api/themes/${seriesId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, reviewer }),
    })
  )
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

export async function fetchTraktStats(seriesName) {
  return handle(await fetch(`/api/trakt/${encodeURIComponent(seriesName)}`))
}

export async function fetchImpactReport() {
  return handle(await fetch('/api/impact'))
}

export async function fetchSourceHealth() {
  return handle(await fetch('/api/source-health'))
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
    })
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

export async function toggleAdmin(id) {
  return handle(await fetch(`/api/admin/users/${id}/toggle-admin`, { method: 'POST' }))
}

export async function fetchDestinationTaxonomy() {
  return handle(await fetch('/api/destinations/taxonomy'))
}

export async function fetchDestinations() {
  return handle(await fetch('/api/destinations'))
}

export async function submitDestinationOverride(seriesId, destinationIds, reviewer) {
  return handle(
    await fetch(`/api/destinations/${seriesId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationIds, reviewer }),
    })
  )
}
