import { useEffect, useState } from 'react'
import { fetchThemeInsight } from '../lib/api.js'

// Tek seri, kategori bazlı büyüklük karşılaştırması — TurkishLearningIndex/RegionalInterest'teki
// aynı .benchmark-card__bars deseni (dataviz skill: "compare magnitude → bar, sequential hue").
export default function ThemeInsight() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchThemeInsight()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('[ThemeInsight]', err.message)
        setStatus('error')
      })
  }, [])

  if (status === 'loading') return <div className="dashboard__empty">Yükleniyor…</div>
  if (status === 'error' || !data?.distribution?.length) {
    return <p className="dashboard__empty">Tema dağılımı şu anda alınamıyor.</p>
  }

  const top = data.distribution.slice(0, 8)
  const maxValue = Math.max(...top.map((d) => d.totalPopularity), 1)

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {top.map((d) => (
          <div key={d.theme} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{d.theme}</div>
            <div className="benchmark-card__row-bar-track">
              <div
                className="benchmark-card__row-bar"
                style={{ width: `${(d.totalPopularity / maxValue) * 100}%`, background: '#9085e9' }}
              />
            </div>
            <div className="benchmark-card__row-value">{d.seriesCount} dizi</div>
          </div>
        ))}
      </div>
      {data.insightText ? (
        <div className="theme-insight__ai-box">
          <span className="theme-insight__ai-label">🤖 Yapay Zeka</span>
          <p>{data.insightText}</p>
        </div>
      ) : (
        <p className="dashboard__empty">Yapay zeka yorumu üretilemedi.</p>
      )}
    </div>
  )
}
