export function trendLabel(trend) {
  if (!trend || trend.direction === 'yetersiz-veri') {
    return { icon: '•', text: 'Takip yeni başladı', className: 'trend--neutral' }
  }
  const pct = trend.changePct > 0 ? `+${trend.changePct}` : `${trend.changePct}`
  const suffix = `(${pct}%, son ${trend.windowDays} gün)`
  if (trend.direction === 'yükseliyor') {
    return { icon: '▲', text: `Yükseliyor ${suffix}`, className: 'trend--up', pct }
  }
  if (trend.direction === 'düşüyor') {
    return { icon: '▼', text: `Düşüyor ${suffix}`, className: 'trend--down', pct }
  }
  return { icon: '→', text: `Sabit ${suffix}`, className: 'trend--flat', pct }
}
