import { useState } from 'react'
import { fetchAdminJobs } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'

// Yönetim → Otomatik işler: zamanlanmış her işin son çalışması, durumu ve topladığı veri (2026-10-09).

const STATE_CLASS = {
  tamam: 'badge--ok',
  gecikti: 'badge--uncertain',
  hata: 'badge--error',
  'hiç çalışmadı': 'badge--muted',
}

export function relTime(ms, now) {
  if (!ms) return '—'
  const dk = Math.round((now - ms) / 60000)
  if (dk < 1) return 'az önce'
  if (dk < 60) return `${dk} dk önce`
  const sa = Math.round(dk / 60)
  if (sa < 48) return `${sa} saat önce`
  return `${Math.round(sa / 24)} gün önce`
}

export function JobsTable({ data, now = Date.parse(data.generatedAt) }) {
  const sorun = data.jobs.filter((j) => j.state === 'hata' || j.state === 'gecikti').length
  return (
    <>
      <div className="dashboard__summary">
        <span className={`dashboard__summary-item${sorun ? ' dashboard__summary-item--warn' : ''}`}>
          {sorun ? `${sorun} işte sorun var` : 'Bütün işler zamanında'}
        </span>
        <span className="dashboard__summary-item">
          Ücretli arama kotası bu ay {new Intl.NumberFormat('tr-TR').format(data.serpapi.used)} /{' '}
          {new Intl.NumberFormat('tr-TR').format(data.serpapi.budget)}
        </span>
      </div>
      <table className="dashboard__table dashboard__table--compact">
        <thead>
          <tr>
            <th scope="col">İş</th>
            <th scope="col">Sıklık</th>
            <th scope="col">Son başarılı</th>
            <th scope="col">Durum</th>
            <th scope="col">Toplanan veri</th>
          </tr>
        </thead>
        <tbody>
          {data.jobs.map((j) => (
            <tr key={j.key}>
              <td>{j.name}</td>
              <td>{j.every}</td>
              <td title={j.lastSuccess ? new Date(j.lastSuccess).toLocaleString('tr-TR') : undefined}>
                {relTime(j.lastSuccess, now)}
              </td>
              <td>
                <span className={`badge ${STATE_CLASS[j.state] ?? ''}`}>{j.state}</span>
                {j.lastError && j.state === 'hata' && <div className="jobs__error">{j.lastError}</div>}
              </td>
              <td className="jobs__data">{j.data ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function JobsStatus() {
  const [n, setN] = useState(0)
  const { status, data, error } = useAsync(fetchAdminJobs, [n])
  return (
    <section className="dashboard__section">
      <h3 className="dashboard__section-title">
        Otomatik işler{' '}
        <button type="button" className="dashboard__link-btn" onClick={() => setN((x) => x + 1)}>
          Yenile
        </button>
      </h3>
      {status === 'loading' && !data && <p className="dashboard__empty">Yükleniyor…</p>}
      {status === 'error' && <p className="dashboard__empty">Durum alınamadı: {error}</p>}
      {data && <JobsTable data={data} />}
    </section>
  )
}
