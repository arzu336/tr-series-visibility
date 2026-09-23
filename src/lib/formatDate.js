const trDateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' })

export function formatTrendsDate(tsSeconds) {
  return trDateFormatter.format(new Date(tsSeconds * 1000))
}
