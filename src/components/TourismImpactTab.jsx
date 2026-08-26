import { useEffect, useState } from 'react'
import { fetchTourismImpact } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function DestinationTable({ topDestinations, otherScore }) {
  const total = topDestinations.reduce((sum, d) => sum + d.totalScore, 0) + otherScore
  if (total === 0) return <p className="dashboard__empty">Henüz hiçbir dizi bir destinasyonla etiketlenmedi.</p>
  return (
    <table className="dashboard__table">
      <thead>
        <tr>
          <th>Destinasyon</th>
          <th>Dizi Sayısı</th>
          <th>Ülke Sayısı</th>
          <th>Skor</th>
          <th>Pay</th>
        </tr>
      </thead>
      <tbody>
        {topDestinations.map((d) => (
          <tr key={d.id}>
            <td>{d.name}</td>
            <td>{d.seriesCount}</td>
            <td>{d.countryCount}</td>
            <td>{round1(d.totalScore)}</td>
            <td>%{round1((d.totalScore / total) * 100)}</td>
          </tr>
        ))}
        {otherScore > 0 && (
          <tr className="dashboard__row--uncertain">
            <td>Diğer destinasyonlar</td>
            <td>—</td>
            <td>—</td>
            <td>{round1(otherScore)}</td>
            <td>%{round1((otherScore / total) * 100)}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function ImpactBadge({ badge }) {
  if (badge === 'pozitif-katki') {
    return <span className="badge badge--ok">Artış Var</span>
  }
  return <span className="badge badge--uncertain">Belirgin Değil</span>
}

function DidTable({ countries }) {
  return (
    <table className="dashboard__table">
      <thead>
        <tr>
          <th>Ülke</th>
          <th>Karşılaştırılan Ülke</th>
          <th>Dizi İzlenirliği</th>
          <th>Turist Sayısındaki Değişim</th>
          <th>Diziyle Bağlantılı Fark</th>
          <th>Sonuç</th>
        </tr>
      </thead>
      <tbody>
        {countries.map((c) => (
          <tr key={c.iso2}>
            <td>{nameOf(c.iso2)}</td>
            <td title={`Neden bu ülke seçildi: ${c.control.reason}`}>{nameOf(c.control.iso2)}</td>
            <td>{round1(c.visibilityScore)}</td>
            <td style={{ color: c.treatmentChangePct >= 0 ? '#5cb85c' : '#f0574a' }}>
              {c.treatmentChangePct != null ? `${c.treatmentChangePct > 0 ? '+' : ''}${c.treatmentChangePct}%` : '—'}
            </td>
            <td style={{ color: c.didEstimate >= 0 ? '#5cb85c' : '#f0574a' }} title="Bu ülkedeki turist artışının, benzer ama dizi etkisi olmayan karşılaştırılan ülkeye göre ne kadar fazla ya da az olduğu.">
              {c.didEstimate > 0 ? '+' : ''}
              {c.didEstimate.toLocaleString('tr-TR')} kişi
            </td>
            <td>
              <ImpactBadge badge={c.impactBadge} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TourismCorrelation({ pendingAnalysis }) {
  if (pendingAnalysis.status !== 'gerçek-veri-mevcut') {
    return (
      <>
        <div className="impact__pending-badges">
          <span className="badge badge--uncertain">Gerçek Veri Bekleniyor</span>
          <span className="badge badge--info" title="Yöntem hazır, gerçek veri bekleniyor.">
            Model Hesaplamaya Hazır
          </span>
        </div>
        <div className="impact__pending">
          <p>{pendingAnalysis.description}</p>
          <p className="impact__pending-label">Gereken kaynaklar:</p>
          <ul>
            {pendingAnalysis.requiredSources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </div>
      </>
    )
  }

  return <DidTable countries={pendingAnalysis.countries} />
}

export default function TourismImpactTab() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    fetchTourismImpact()
      .then((res) => {
        setData(res)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error' || !data) return <div className="dashboard status status--error">Veri alınamadı.</div>

  return (
    <>
      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Destinasyon Görünürlük Tablosu</h3>
        <DestinationTable topDestinations={data.topDestinations} otherScore={data.otherDestinationsScore} />
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Diziler Turizmi Etkiliyor mu?</h3>
        <TourismCorrelation pendingAnalysis={data.pendingAnalysis} />
      </section>
    </>
  )
}
