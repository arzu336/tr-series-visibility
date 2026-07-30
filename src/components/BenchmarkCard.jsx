import { useEffect, useState } from 'react'
import { fetchBenchmark } from '../lib/api.js'

// Türkiye'nin marka rengiyle (#EE3135, bkz. styles.css .app__nav-btn--active) tutarlı,
// diğer üç ülke için dataviz-skill paletinden (ImpactReport.jsx SLOT_COLORS) ödünç alınan
// nötr kategorik renkler — yeni bir palet icat edilmedi.
const COUNTRY_COLORS = { TR: '#EE3135', US: '#3987e5', KR: '#9085e9', ES: '#d95926' }

function TrendBadge({ trend }) {
  if (!trend || trend.direction === 'yetersiz-veri') {
    return <span className="badge badge--uncertain">Trend verisi birikiyor</span>
  }
  const tone = trend.direction === 'yükseliyor' ? 'trend--up' : trend.direction === 'düşüyor' ? 'trend--down' : ''
  const icon = trend.direction === 'yükseliyor' ? '▲' : trend.direction === 'düşüyor' ? '▼' : '→'
  return (
    <span className={tone}>
      {icon} {trend.changePct > 0 ? '+' : ''}
      {trend.changePct}% ({trend.windowDays} gün)
    </span>
  )
}

export default function BenchmarkCard() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchBenchmark()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  if (status === 'loading') return <div className="status">Yükleniyor…</div>
  if (status === 'error') return <div className="status status--error">Hata: {error}</div>

  const maxShare = Math.max(...data.countries.map((c) => c.marketSharePct), 1)

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {data.countries.map((c) => (
          <div key={c.code} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{c.name}</div>
            <div className="benchmark-card__row-bar-track">
              <div
                className="benchmark-card__row-bar"
                style={{ width: `${(c.marketSharePct / maxShare) * 100}%`, background: COUNTRY_COLORS[c.code] || '#5a6478' }}
              />
            </div>
            <div className="benchmark-card__row-value">%{c.marketSharePct}</div>
          </div>
        ))}
      </div>

      <table className="dashboard__table dashboard__table--compact">
        <thead>
          <tr>
            <th>Ülke</th>
            <th>İhracat Yapılan Ülke Sayısı</th>
            <th>Trend İvmesi</th>
          </tr>
        </thead>
        <tbody>
          {data.countries.map((c) => (
            <tr key={c.code}>
              <td>{c.name}</td>
              <td>{c.exportCountryCount}</td>
              <td>
                <TrendBadge trend={c.trend} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="dashboard__hint">{data.methodology}</p>
    </div>
  )
}
