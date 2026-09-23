import { useEffect, useState } from 'react'
import { fetchExportImpact, fetchBenchmark, fetchGlobalPeriods } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import { trendLabel } from '../lib/trend.js'
import DonutChart from './DonutChart.jsx'
import DonutRankedList from './DonutRankedList.jsx'
import PeriodChart from './PeriodChart.jsx'

const SLOT_COLORS = ['#3987e5', '#d55181', '#9085e9', '#d95926', '#199e70']

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function toDonutItems(rawItems) {
  const total = rawItems.reduce((sum, i) => sum + i.value, 0)
  let colorIdx = 0
  return rawItems.map((item) => {
    const pct = total > 0 ? round1((item.value / total) * 100) : 0
    const color = item.isOther ? null : SLOT_COLORS[colorIdx++ % SLOT_COLORS.length]
    return { ...item, pct, color, valueLabel: item.value.toFixed(1) }
  })
}

function RisingMarketsTable({ risingCountries }) {
  if (risingCountries.length === 0) {
    return (
      <p className="dashboard__empty">
        Trend verisi birikiyor — gerçek bir yükseliş tespiti için en az birkaç günlük takip gerekiyor.
      </p>
    )
  }
  return (
    <table className="dashboard__table">
      <thead>
        <tr>
          <th>Pazar</th>
          <th>Değişim (son 7 gün)</th>
          <th>Kıyaslama Ülkesi</th>
        </tr>
      </thead>
      <tbody>
        {risingCountries.map((c) => (
          <tr key={c.iso2}>
            <td>
              {nameOf(c.iso2)}
              {c.hasOfficialPlatformData && (
                <span
                  className="panel__series-source-tag"
                  style={{ marginLeft: '0.4rem' }}
                  title="Bu ülke için resmi Netflix Top 10 verisiyle doğrulandı (bkz. Yerel Sıralama, harita panelinde)."
                >
                  Netflix Top 10 ✓
                </span>
              )}
            </td>
            <td style={{ color: '#5cb85c', fontWeight: 600 }}>+{c.changePct}%</td>
            <td>
              {c.suggestedControl ? (
                <span title={c.suggestedControl.reason}>
                  {countryNames[c.suggestedControl.iso2]?.name || c.suggestedControl.name || c.suggestedControl.iso2}
                </span>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ExportImpactTab({ onSelectCountry }) {
  const [data, setData] = useState(null)
  const [marketShare, setMarketShare] = useState(null)
  const [status, setStatus] = useState('loading')
  const [hoveredCountryId, setHoveredCountryId] = useState(null)
  const [periodRange, setPeriodRange] = useState('monthly')
  const [periodData, setPeriodData] = useState(null)
  const [periodLoading, setPeriodLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchExportImpact(), fetchBenchmark().catch(() => null)])
      .then(([exportData, benchmarkData]) => {
        setData(exportData)
        const tr = benchmarkData?.countries?.find((c) => c.code === 'TR')
        setMarketShare(tr?.marketSharePct ?? null)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => {
    let cancelled = false
    setPeriodLoading(true)
    fetchGlobalPeriods(periodRange)
      .then((res) => {
        if (cancelled) return
        setPeriodData(res)
        setPeriodLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[ExportImpactTab] periods', err.message)
        setPeriodLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [periodRange])

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error' || !data) return <div className="dashboard status status--error">Veri alınamadı.</div>

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
  const topCountryShare = round1(countryDonutItems.filter((i) => !i.isOther).reduce((sum, i) => sum + i.pct, 0))
  const otherCountryCount = Math.max(0, data.totalCountries - data.topCountriesByVisibility.length)

  return (
    <>
      <section className="dashboard__section">
        <div className="dashboard__header-row">
          <h3 className="dashboard__section-title">İlk 5 Pazar Yoğunlaşması</h3>
          {marketShare != null && (
            <span className="badge badge--info" title="Türkiye'nin toplam küresel dizi ihracat pazarındaki payı (bkz. Küresel Kıyaslama).">
              Türkiye Küresel Pazar Payı: %{marketShare}
            </span>
          )}
        </div>
        <div className="donut-panel__body">
          <DonutChart
            items={countryDonutItems}
            hoveredId={hoveredCountryId}
            onHoverChange={setHoveredCountryId}
            onSelect={onSelectCountry ? (s) => onSelectCountry(s.iso2) : undefined}
            centerPrimary={`%${topCountryShare}`}
            centerSecondary="İLK 5 PAZARIN PAYI"
          />
          <DonutRankedList
            items={countryDonutItems}
            hoveredId={hoveredCountryId}
            onHoverChange={setHoveredCountryId}
            onSelect={onSelectCountry ? (s) => onSelectCountry(s.iso2) : undefined}
          />
        </div>
        <p className="donut-panel__hint">
          İlk 5 pazar toplam görünürlüğün %{topCountryShare}'ini oluşturuyor; kalan {otherCountryCount} ülke geri
          kalan payı paylaşıyor.
        </p>
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Yükselen Pazarlar</h3>
        <p className="dashboard__hint">Görünürlüğü en hızlı artan pazarlar, son 7 gün.</p>
        <RisingMarketsTable risingCountries={data.risingCountries} />
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Zaman İçinde Görünürlük</h3>
        <p className="dashboard__hint">Toplam görünürlük skorunun ay/yıl bazında değişimi.</p>
        <div style={{ opacity: periodLoading ? 0.5 : 1, transition: 'opacity 200ms ease' }}>
          <PeriodChart
            periods={periodData?.periods || []}
            valueKey={periodRange === 'yearly' ? 'avgMonthlyScore' : 'totalScore'}
            range={periodRange}
            onRangeChange={setPeriodRange}
            unitLabel="puan"
          />
        </div>
      </section>
    </>
  )
}
