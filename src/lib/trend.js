// Sunucudaki getTrend() çıktısını (server/history.js) tutarlı ikon/metin/renk
// sınıfına çevirir — ülke paneli, etki raporu merkez metrikleri ve donut
// sıralı listesi aynı sözlüğü paylaşır.
export function trendLabel(trend) {
  if (!trend || trend.direction === 'yetersiz-veri') {
    return { icon: '•', text: 'Yetersiz veri (takip yeni başladı)', className: 'trend--neutral' }
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
