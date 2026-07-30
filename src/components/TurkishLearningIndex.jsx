import { useEffect, useState } from 'react'
import { fetchTurkishLearningIndex, fetchDuolingoStats } from '../lib/api.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import countryNames from '../data/country-centroids.json'

function displayName(entry) {
  const iso2 = resolveIso2FromLabel(entry.country)
  return iso2 ? countryNames[iso2].name : entry.country
}

const TOP_N = 10

// Duolingo'nun herkese açık API'si ülke bazlı değil, KÜRESEL tek bir "Türkçe öğrenen toplam
// kullanıcı" sayısı veriyor (bkz. server/duolingo.js) — bu yüzden ülke bazlı Google Trends
// listesiyle karıştırılmadan, açıkça "🌍 Küresel" etiketli ayrı bir kart olarak gösteriliyor.
function GlobalDuolingoCard() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchDuolingoStats()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch((err) => {
        console.error('[GlobalDuolingoCard]', err.message)
        setStatus('unavailable')
      })
  }, [])

  if (status === 'loading') return <div className="dashboard__empty">Yükleniyor…</div>
  if (status === 'unavailable' || !data) {
    return <p className="dashboard__empty">Duolingo verisi şu anda alınamıyor.</p>
  }

  const { trend } = data
  const trendText =
    trend.direction === 'yetersiz-veri'
      ? 'Trend verisi birikiyor'
      : `${trend.direction === 'yükseliyor' ? '▲' : trend.direction === 'düşüyor' ? '▼' : '→'} ${
          trend.changePct > 0 ? '+' : ''
        }${trend.changePct}% (son ${trend.windowDays} gün)`

  return (
    <div className="global-stat-card">
      <div className="global-stat-card__label">🌍 Küresel Duolingo Türkçe Öğrencisi</div>
      <div className="global-stat-card__value">{new Intl.NumberFormat('tr-TR').format(data.totalLearners)}</div>
      <div className="global-stat-card__trend">{trendText}</div>
      <p className="dashboard__hint" style={{ margin: '0.4rem 0 0' }}>
        Duolingo'nun herkese açık kurs listesinden gerçek, ülke bazlı DEĞİL küresel tek bir
        rakam — Duolingo ülke bazlı öğrenci kırılımı sağlamıyor.
      </p>
    </div>
  )
}

export default function TurkishLearningIndex() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchTurkishLearningIndex()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch((err) => {
        // SERPAPI_API_KEY yoksa, kota dolmuşsa veya geçici bir ağ hatası olursa: sahte bir
        // sayı göstermek yerine dürüst "veri birikiyor" durumuna düşülür (bkz. impact.js).
        console.error('[TurkishLearningIndex]', err.message)
        setStatus('pending')
      })
  }, [])

  return (
    <div>
      <GlobalDuolingoCard />

      {status === 'loading' && <div className="status">Yükleniyor…</div>}

      {status === 'pending' || (status === 'ready' && !data?.byCountry?.length) ? (
        <p className="dashboard__empty" style={{ marginTop: '0.75rem' }}>
          Veri birikiyor — "learn Turkish", "Türkçe kursu" ve "Turkish language course" için
          gerçek Google Trends arama hacmi henüz alınamadı.
        </p>
      ) : null}

      {status === 'ready' && data?.byCountry?.length > 0 && (
        <div className="benchmark-card" style={{ marginTop: '0.75rem' }}>
          <div className="benchmark-card__bars">
            {(() => {
              const top = data.byCountry.slice(0, TOP_N)
              const maxValue = Math.max(...top.map((x) => x.value), 1)
              return top.map((c) => (
                <div key={c.country} className="benchmark-card__row">
                  <div className="benchmark-card__row-label">{displayName(c)}</div>
                  <div className="benchmark-card__row-bar-track">
                    <div
                      className="benchmark-card__row-bar"
                      style={{ width: `${(c.value / maxValue) * 100}%`, background: '#199e70' }}
                    />
                  </div>
                  <div className="benchmark-card__row-value">{c.value}</div>
                </div>
              ))
            })()}
          </div>
          <p className="dashboard__hint">
            Ülke bazlı: Google Trends arama hacmi endeksi (0-100) — "learn Turkish", "Türkçe
            kursu" ve "Turkish language course" terimlerinin ortalaması. Gerçek kurs kaydı/
            öğrenci sayısı değil, arama ilgisine dayalı bir yakınsama (proxy) göstergesidir.
          </p>
        </div>
      )}
    </div>
  )
}
