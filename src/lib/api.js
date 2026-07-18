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

export async function fetchImpactReport() {
  return handle(await fetch('/api/impact'))
}
