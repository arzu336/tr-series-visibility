import { useEffect, useState } from 'react'
import { fetchImpactReport } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PieChart from './PieChart.jsx'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function RankList({ items, accent = '#f03b20' }) {
  if (items.length === 0) return null
  const maxValue = Math.max(...items.map((i) => i.value))
  return (
    <div className="impact__rank-list">
      {items.map((item) => (
        <div key={item.label} className="impact__rank-item">
          <span className="impact__rank-label">{item.label}</span>
          <div className="impact__rank-bar">
            <div
              className="impact__rank-fill"
              style={{ width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`, background: accent }}
            />
          </div>
          <span className="impact__rank-value">{item.valueLabel}</span>
          {item.meta && <span className="impact__rank-meta">{item.meta}</span>}
        </div>
      ))}
    </div>
  )
}

export default function ImpactReport({ onSelectCountry, onSelectDestination }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchImpactReport()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  const countryPieItems = [
    ...data.topCountriesByVisibility.map((c) => ({
      label: nameOf(c.iso2),
      value: c.score,
      valueLabel: c.score.toFixed(1),
      iso2: c.iso2,
    })),
    ...(data.otherCountriesScore > 0
      ? [{ label: 'Diğer ülkeler', value: data.otherCountriesScore, valueLabel: data.otherCountriesScore.toFixed(1), isOther: true }]
      : []),
  ]

  const destinationPieItems = [
    ...data.topDestinations.map((d) => ({
      label: d.name,
      value: d.totalScore,
      valueLabel: d.totalScore.toFixed(1),
    })),
    ...(data.otherDestinationsScore > 0
      ? [{ label: 'Diğer destinasyonlar', value: data.otherDestinationsScore, valueLabel: data.otherDestinationsScore.toFixed(1), isOther: true }]
      : []),
  ]

  const risingItems = data.risingCountries.map((c) => ({
    label: nameOf(c.iso2),
    value: c.changePct,
    valueLabel: `+${c.changePct}%`,
    meta: `son ${c.windowDays} gün`,
  }))

  return (
    <div className="dashboard">
      <h2>Etki Raporu</h2>

      <h3>Şu Anki Öne Çıkanlar</h3>
      <p className="dashboard__hint">
        Canlı TMDB verisinden hesaplanan gerçek görünürlük skorları — tahmin veya örnek veri değil.
        "Diğer" dilimi, listelenmeyen kalan {data.topCountriesByVisibility.length < 6 ? 'ülkelerin' : 'kalemlerin'} toplamını temsil eder.
      </p>
      <div className="impact__pie-section">
        <div>
          <h4 className="impact__rank-title">Görünürlük skoruna göre en öndeki ülkeler</h4>
          <PieChart
            items={countryPieItems}
            onSliceClick={onSelectCountry ? (s) => onSelectCountry(s.iso2) : undefined}
          />
          {onSelectCountry && <p className="pie-chart__hint">Bir ülkeye tıklayarak haritadaki detayını açabilirsiniz.</p>}
        </div>
        <div>
          <h4 className="impact__rank-title">En çok görünürlük kazanan destinasyonlar</h4>
          {destinationPieItems.length > 0 ? (
            <>
              <PieChart items={destinationPieItems} onSliceClick={onSelectDestination ? () => onSelectDestination() : undefined} />
              {onSelectDestination && (
                <p className="pie-chart__hint">Bir destinasyona tıklayarak Destinasyonlar sekmesine geçebilirsiniz.</p>
              )}
            </>
          ) : (
            <p className="dashboard__empty">Henüz hiçbir dizi bir destinasyonla etiketlenmedi.</p>
          )}
        </div>
      </div>

      <h3>Yükselen Ülkeler</h3>
      {data.hasEnoughHistoryForTrends && risingItems.length > 0 ? (
        <RankList items={risingItems} accent="#5cb85c" />
      ) : (
        <p className="dashboard__empty">
          Trend verisi birikiyor — gerçek bir yükseliş/düşüş tespiti için en az birkaç günlük takip
          gerekiyor. Uydurma bir yön göstermek yerine bekliyoruz.
        </p>
      )}

      <h3>{data.pendingAnalysis.title} — Gerçek Veri Bekleniyor</h3>
      <div className="impact__pending">
        <p>{data.pendingAnalysis.description}</p>
        <p className="impact__pending-label">Gereken kaynaklar:</p>
        <ul>
          {data.pendingAnalysis.requiredSources.map((src) => (
            <li key={src}>{src}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
