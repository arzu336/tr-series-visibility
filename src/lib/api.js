export async function fetchVisibility() {
  const res = await fetch('/api/visibility')
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `İstek başarısız (${res.status})`)
  }
  return res.json()
}
