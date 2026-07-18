import { useEffect, useState } from 'react'
import { fetchImpactReport } from '../lib/api.js'
import ScatterChart from './ScatterChart.jsx'

function fmtPct(n) {
  return `${n > 0 ? '+' : ''}${n}%`
}

function strengthLabel(r) {
  const abs = Math.abs(r)
  if (abs >= 0.7) return 'çok güçlü'
  if (abs >= 0.4) return 'güçlü'
  if (abs >= 0.2) return 'orta düzeyde'
  return 'zayıf'
}

function CorrelationBox({ title, stat }) {
  if (!stat) return null
  return (
    <div className="impact__corr-box">
      {title && <h4>{title}</h4>}
      <p className="impact__corr-value">r = {stat.r}</p>
      <p className="impact__corr-meta">
        n = {stat.n}
        {stat.ci95 && (
          <>
            {' · '}%95 GA: [{stat.ci95.low}, {stat.ci95.high}]
          </>
        )}
      </p>
    </div>
  )
}

export default function ImpactReport() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [showTable, setShowTable] = useState(false)

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

  const { tourism, export: exportCorr } = data.correlations
  const n = data.cases.length

  return (
    <div className="dashboard">
      <h2>Etki Raporu — Turizm/İhracat Korelasyonu</h2>

      <div className="impact__disclaimer">
        Turist girişi ve ihracat rakamları <strong>örnek/açıklayıcıdır</strong> — gerçek TÜİK ve
        Kültür Turizm Bakanlığı verisi kurumsal talep gerektiriyor. Aşağıdaki korelasyon
        hesaplaması gerçek istatistik yöntemidir (DiD düzeltmesi + Pearson korelasyonu); sadece
        girdi rakamları örnektir.
      </div>

      <p className="impact__summary">
        İncelenen <strong>{n} ülkede</strong>: dizi görünürlüğü arttıkça turizmde{' '}
        <strong>{strengthLabel(tourism.r)}</strong> (r={tourism.r}), ihracatta{' '}
        <strong>{strengthLabel(exportCorr.r)}</strong> (r={exportCorr.r}) bir birliktelik
        gözlemleniyor. Küçük örneklem nedeniyle güven aralıkları geniş — bu bir kanıt değil,
        ilişki gücü göstergesidir.
      </p>

      <div className="impact__charts">
        <div className="impact__chart-box">
          <h4>Görünürlük ↔ Turizm</h4>
          <ScatterChart
            data={data.cases.map((c) => ({ x: c.adjustedTourismChangePct, y: c.visibilityChangePct, label: c.country }))}
            xLabel="Düzeltilmiş turist değişimi"
            yLabel="Görünürlük değişimi"
          />
          <CorrelationBox title="" stat={tourism} />
        </div>
        <div className="impact__chart-box">
          <h4>Görünürlük ↔ İhracat</h4>
          <ScatterChart
            data={data.cases.map((c) => ({ x: c.adjustedExportChangePct, y: c.visibilityChangePct, label: c.country }))}
            xLabel="Düzeltilmiş ihracat değişimi"
            yLabel="Görünürlük değişimi"
            accentColor="#5cb85c"
          />
          <CorrelationBox title="" stat={exportCorr} />
        </div>
      </div>

      <button className="dashboard__link-btn" onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Ayrıntılı tabloyu gizle' : 'Ayrıntılı tabloyu göster'}
      </button>

      {showTable && (
        <>
          <p className="dashboard__hint" style={{ marginTop: '0.75rem' }}>
            Yöntem: her ülkenin ham turist/ihracat değişiminden, benzer makroekonomik dinamiklere
            sahip ama dizi trendi yaşamamış bir kontrol ülkesinin değişimi çıkarılır (DiD). Kalan
            "düzeltilmiş" değişim, dizi görünürlüğü artışıyla karşılaştırılır.
          </p>
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Ülke</th>
                <th>Kontrol Ülkesi</th>
                <th>Trend Tema</th>
                <th>Görünürlük Δ</th>
                <th>Turist Δ (ham → düzeltilmiş)</th>
                <th>İhracat Δ (ham → düzeltilmiş)</th>
                <th>Pencere</th>
              </tr>
            </thead>
            <tbody>
              {data.cases.map((c) => (
                <tr key={c.country}>
                  <td>{c.country}</td>
                  <td>{c.controlCountry}</td>
                  <td>{c.theme}</td>
                  <td>{fmtPct(c.visibilityChangePct)}</td>
                  <td>
                    {fmtPct(c.rawTourismChangePct)} → {fmtPct(c.adjustedTourismChangePct)}
                  </td>
                  <td>
                    {fmtPct(c.rawExportChangePct)} → {fmtPct(c.adjustedExportChangePct)}
                  </td>
                  <td>{c.windowMonths} ay</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
