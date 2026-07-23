import { useEffect, useState } from 'react'
import { fetchImpactReport, fetchSourceHealth } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import { trendLabel } from '../lib/trend.js'
import DonutChart from './DonutChart.jsx'
import DonutRankedList from './DonutRankedList.jsx'
import SourceHealth from './SourceHealth.jsx'

// Doğrulanmış kategorik palet (dataviz skill, --mode dark, gerçek arka planımız #05070d'ye
// göre validate_palette.js ile kontrol edildi) — sabit sırayla atanır, asla döngüyle
// üretilmez. "Diğer" dilimi gerçek bir kimlik değil, kalan toplamı temsil ettiği için
// donut bileşeninin kendi nötr grisine (OTHER_COLOR) bırakılır.
const SLOT_COLORS = ['#3987e5', '#d55181', '#9085e9', '#d95926', '#199e70']

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function round1(n) {
  return Math.round(n * 10) / 10
}

// items: [{ id, label, value, isOther? }] (en büyükten küçüğe, "Diğer" en sonda) ->
// DonutChart + DonutRankedList'in ortak beklediği { valueLabel, pct, color } eklenmiş hali.
function toDonutItems(rawItems) {
  const total = rawItems.reduce((sum, i) => sum + i.value, 0)
  let colorIdx = 0
  return rawItems.map((item) => {
    const pct = total > 0 ? round1((item.value / total) * 100) : 0
    const color = item.isOther ? null : SLOT_COLORS[colorIdx++ % SLOT_COLORS.length]
    return { ...item, pct, color, valueLabel: item.valueLabel ?? item.value.toFixed(1) }
  })
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
          {item.control && (
            <span className="impact__rank-control">
              Önerilen DiD kontrol ülkesi: <strong>{item.control.label}</strong> ({item.control.reason})
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function ImpactReport({ onSelectCountry }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [hoveredCountryId, setHoveredCountryId] = useState(null)
  const [hoveredDestId, setHoveredDestId] = useState(null)
  const [sourceHealth, setSourceHealth] = useState(null)
  const [sourceHealthError, setSourceHealthError] = useState(null)

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
    fetchSourceHealth()
      .then(setSourceHealth)
      .catch((err) => setSourceHealthError(err.message))
  }, [])

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  const countryDonutItems = toDonutItems([
    ...data.topCountriesByVisibility.map((c) => ({
      id: c.iso2,
      label: nameOf(c.iso2),
      value: c.score,
      iso2: c.iso2,
      trend: c.trend && c.trend.direction !== 'yetersiz-veri' ? trendLabel(c.trend) : null,
    })),
    ...(data.otherCountriesScore > 0
      ? [{ id: 'other-country', label: 'Diğer ülkeler', value: data.otherCountriesScore, isOther: true }]
      : []),
  ])

  const destinationDonutItems = toDonutItems([
    ...data.topDestinations.map((d) => ({
      id: d.id,
      label: d.name,
      value: d.totalScore,
      seriesCount: d.seriesCount,
    })),
    ...(data.otherDestinationsScore > 0
      ? [{ id: 'other-destination', label: 'Diğer destinasyonlar', value: data.otherDestinationsScore, isOther: true }]
      : []),
  ])

  const risingItems = data.risingCountries.map((c) => ({
    label: nameOf(c.iso2),
    value: c.changePct,
    valueLabel: `+${c.changePct}%`,
    meta: `son ${c.windowDays} gün`,
    // country-centroids.json bazı küçük bölgeleri (Channel Islands, Faroe Adaları vb.)
    // içermeyebilir — World Bank'ın kendi verdiği isim yedek olarak kullanılıyor,
    // çıplak ISO2 kodu (ör. "JG") kullanıcıya hiç gösterilmiyor.
    control: c.suggestedControl
      ? {
          label: countryNames[c.suggestedControl.iso2]?.name || c.suggestedControl.name || c.suggestedControl.iso2,
          reason: c.suggestedControl.reason,
        }
      : null,
  }))

  const countryCenterTrend = data.hasEnoughHistoryForTrends
    ? {
        icon: data.risingCount > data.fallingCount ? '▲' : data.fallingCount > data.risingCount ? '▼' : '→',
        tone: data.risingCount > data.fallingCount ? 'up' : data.fallingCount > data.risingCount ? 'down' : 'flat',
        text: `${data.risingCount} pazar yükselişte, ${data.fallingCount} düşüşte`,
      }
    : { icon: '•', tone: 'neutral', text: 'Trend verisi birikiyor' }

  const topCountryShare = round1(
    countryDonutItems.filter((item) => !item.isOther).reduce((sum, item) => sum + item.pct, 0)
  )
  const otherCountryCount = Math.max(0, data.totalCountries - data.topCountriesByVisibility.length)
  const otherCountryShare = countryDonutItems.find((item) => item.isOther)?.pct ?? 0

  const topDestination = destinationDonutItems.find((i) => !i.isOther)
  const destinationCenterTrend = topDestination
    ? { icon: '•', tone: 'neutral', text: `${topDestination.seriesCount} dizide öne çıkıyor` }
    : null

  return (
    <div className="dashboard">
      <div className="dashboard__header-row">
        <h2>Etki Raporu</h2>
        <div className="dashboard__export-actions">
          <button className="dashboard__export-btn dashboard__export-btn--ghost" onClick={() => window.print()}>
            🖨 PDF Olarak Yazdır
          </button>
        </div>
      </div>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Şu Anki Öne Çıkanlar</h3>
        <p className="dashboard__hint">
          Canlı veriden hesaplanan gerçek görünürlük skorları — tahmin veya örnek veri değil.
          "Diğer" dilimi, listelenmeyen kalan {data.topCountriesByVisibility.length < 6 ? 'ülkelerin' : 'kalemlerin'} toplamını temsil eder.
        </p>
        <div className="donut-panels">
          <div className="donut-panel">
            <h4 className="impact__rank-title">Görünürlük skoruna göre en öndeki ülkeler</h4>
            <div className="donut-panel__body">
              <DonutChart
                items={countryDonutItems}
                hoveredId={hoveredCountryId}
                onHoverChange={setHoveredCountryId}
                onSelect={onSelectCountry ? (s) => onSelectCountry(s.iso2) : undefined}
                centerPrimary={`%${topCountryShare}`}
                centerSecondary="İLK 5 PAZARIN PAYI"
                centerTrend={countryCenterTrend}
              />
              <DonutRankedList
                items={countryDonutItems}
                hoveredId={hoveredCountryId}
                onHoverChange={setHoveredCountryId}
                onSelect={onSelectCountry ? (s) => onSelectCountry(s.iso2) : undefined}
              />
            </div>
            <p className="donut-panel__hint">
              İlk 5 pazar toplam görünürlüğün %{topCountryShare}'ini oluşturuyor; kalan {otherCountryCount} ülke %{otherCountryShare} paya sahip.
              {onSelectCountry && ' Bir ülkeye tıklayarak haritadaki detayını açabilirsiniz.'}
            </p>
          </div>
          <div className="donut-panel">
            <h4 className="impact__rank-title">En çok görünürlük kazanan destinasyonlar</h4>
            {destinationDonutItems.length > 0 ? (
              <div className="donut-panel__body">
                <DonutChart
                  items={destinationDonutItems}
                  hoveredId={hoveredDestId}
                  onHoverChange={setHoveredDestId}
                  centerPrimary={topDestination ? `%${topDestination.pct}` : '—'}
                  centerSecondary={topDestination ? topDestination.label.toLocaleUpperCase('tr') : ''}
                  centerTrend={destinationCenterTrend}
                />
                <DonutRankedList items={destinationDonutItems} hoveredId={hoveredDestId} onHoverChange={setHoveredDestId} />
              </div>
            ) : (
              <p className="dashboard__empty">Henüz hiçbir dizi bir destinasyonla etiketlenmedi.</p>
            )}
          </div>
        </div>
      </section>

      <SourceHealth data={sourceHealth} error={sourceHealthError} />

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Yükselen Ülkeler</h3>
        {data.hasEnoughHistoryForTrends && risingItems.length > 0 ? (
          <RankList items={risingItems} accent="#5cb85c" />
        ) : (
          <p className="dashboard__empty">
            Trend verisi birikiyor — gerçek bir yükseliş/düşüş tespiti için en az birkaç günlük takip
            gerekiyor. Uydurma bir yön göstermek yerine bekliyoruz.
          </p>
        )}
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">{data.pendingAnalysis.title} — Gerçek Veri Bekleniyor</h3>
        <div className="impact__pending">
          <p>{data.pendingAnalysis.description}</p>
          <p className="impact__pending-label">Gereken kaynaklar:</p>
          <ul>
            {data.pendingAnalysis.requiredSources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
