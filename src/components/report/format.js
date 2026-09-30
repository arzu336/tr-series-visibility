const TR = 'tr-TR'

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(TR, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(TR, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** ISO hafta tarihi (YYYY-MM-DD) — Netflix haftaları; saat dilimi kayması olmasın diye yerel ayrıştırma. */
export function fmtWeek(ymd) {
  if (!ymd) return '—'
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return String(ymd)
  return new Date(y, m - 1, d).toLocaleDateString(TR, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtNum(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(TR, { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `%${fmtNum(n, digits)}`
}

export function fmtSignedPct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${fmtPct(n, digits)}`
}

/** "2026-07" → "Tem 2026" */
export function fmtPeriod(period) {
  if (!period) return '—'
  const [y, m] = String(period).split('-').map(Number)
  if (!y || !m) return String(period)
  return new Date(y, m - 1, 1).toLocaleDateString(TR, { month: 'short', year: 'numeric' })
}
