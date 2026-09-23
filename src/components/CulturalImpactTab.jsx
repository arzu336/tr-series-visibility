import { useEffect, useState } from 'react'
import { fetchCulturalImpact } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import BenchmarkCard from './BenchmarkCard.jsx'
import TurkishLearningIndex from './TurkishLearningIndex.jsx'
import ThemeInsight from './ThemeInsight.jsx'

const SENTIMENT_LABELS = { avgPositive: 'Olumlu', avgNeutral: 'Nötr', avgNegative: 'Olumsuz' }
const SENTIMENT_COLORS = { avgPositive: '#5cb85c', avgNeutral: '#6da7ec', avgNegative: '#e5484d' }
const TONE_LABELS = { positive: 'Olumlu', neutral: 'Nötr', negative: 'Olumsuz' }

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function MediaSentimentByCountryTable({ rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <table className="dashboard__table dashboard__table--compact" style={{ marginTop: '0.9rem' }}>
      <thead>
        <tr>
          <th>Ülke</th>
          <th>Taranan Dizi</th>
          <th>Olumlu %</th>
          <th>Baskın Ton</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.iso2}>
            <td>{nameOf(r.iso2)}</td>
            <td>{r.seriesCount}</td>
            <td>%{r.avgPositivePct}</td>
            <td>
              <span className={`badge badge--${r.dominantTone === 'positive' ? 'ok' : r.dominantTone === 'negative' ? 'uncertain' : 'info'}`}>
                {TONE_LABELS[r.dominantTone]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MediaSentimentSummary({ summary, byCountry }) {
  if (!summary || summary.status === 'pending' || summary.sampleSize === 0) {
    return (
      <p className="dashboard__empty">
        Henüz hiçbir dizi/ülke için basın taraması yapılmadı — haritada bir dizi genişletip "Şimdi Tara"ya
        bastıkça bu özet gerçek verilerle dolacak.
      </p>
    )
  }
  return (
    <>
      <div className="benchmark-card">
        <div className="benchmark-card__bars">
          {['avgPositive', 'avgNeutral', 'avgNegative'].map((key) => (
            <div key={key} className="benchmark-card__row">
              <div className="benchmark-card__row-label">{SENTIMENT_LABELS[key]}</div>
              <div className="benchmark-card__row-bar-track">
                <div
                  className="benchmark-card__row-bar"
                  style={{ width: `${Math.round(summary[key] * 100)}%`, background: SENTIMENT_COLORS[key] }}
                />
              </div>
              <div className="benchmark-card__row-value">%{Math.round(summary[key] * 100)}</div>
            </div>
          ))}
        </div>
      </div>

      <h4 className="impact__rank-title" style={{ marginTop: '1.1rem' }}>Ülke Bazlı Medya Algısı</h4>
      <MediaSentimentByCountryTable rows={byCountry} />
    </>
  )
}

export default function CulturalImpactTab() {
  const [summary, setSummary] = useState(null)
  const [byCountry, setByCountry] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchCulturalImpact()
      .then((res) => {
        setSummary(res.mediaSentimentSummary)
        setByCountry(res.mediaSentimentByCountry || [])
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  return (
    <>
      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Tema Dağılımı</h3>
        <p className="dashboard__hint">Yapay zeka yorumu dahil.</p>
        <ThemeInsight />
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Küresel Kıyaslama — Türkiye vs ABD, Güney Kore, İspanya</h3>
        <p className="dashboard__hint">Türkiye vs en büyük 3 dizi ihracatçısı ülke.</p>
        <BenchmarkCard />
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Türkçe Öğrenme İlgi Endeksi</h3>
        <p className="dashboard__hint">Arama ilgisine dayalı.</p>
        <TurkishLearningIndex />
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Medya & Basın Algısı Özeti</h3>
        {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
        {status === 'error' && <p className="dashboard__empty">Veri alınamadı.</p>}
        {status === 'ready' && <MediaSentimentSummary summary={summary} byCountry={byCountry} />}
      </section>
    </>
  )
}
