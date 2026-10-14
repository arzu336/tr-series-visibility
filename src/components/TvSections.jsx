import { useMemo, useState } from 'react'
import {
  fetchCountryTv,
  fetchSeriesTv,
  fetchTvAdmin,
  runTvGuide,
  mapTvTitle,
  importSalesCsv,
  fetchTrendSeriesList,
  waitForJob,
} from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import countryNames from '../data/country-centroids.json'
import Flag from './Flag.jsx'
import ChartList from './ChartList.jsx'

// Çevrimiçi izlenme (video siteleri ve ülke yayıncılarının YouTube kanalları): ülke paneli ve dizi sayfası. TV yayın
// akışı ve satış kayıtları ekrandan kaldırıldı (2026-10-14, kullanıcı isteği); toplama sürüyor, TvAdmin yönetimde değil.

const day = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '')
const views = (n) => Number(n || 0).toLocaleString('tr-TR')

/**
 * Ülke paneli: son 30 günde televizyonda yayınlanan Türk dizileri ve satış kayıtları — paneldeki diğer listelerle
 * aynı afişli liste. `seriesInfo`: dizi kimliği → { name, posterPath } (haritanın yüklediği katalogdan).
 */
export function CountryTv({ iso2, seriesInfo, onSelectSeries }) {
  const { status, data } = useAsync(() => fetchCountryTv(iso2), [iso2])
  const online = data?.online || []
  if (status !== 'ready' || !online.length) return null
  const info = (id) => ({ name: seriesInfo.get(id)?.name || `#${id}`, posterPath: seriesInfo.get(id)?.posterPath })
  return (
    <>
      <h3>Çevrimiçi izlenme</h3>
      <ChartList
        compact
        showPosters
        items={online.map((o, i) => ({
          rank: i + 1,
          seriesId: o.seriesId,
          kind: 'series',
          ...info(o.seriesId),
          meta: `${views(o.views)} izlenme · ${o.videos} video`,
        }))}
        onSelect={onSelectSeries}
      />
    </>
  )
}

/** Dizi sayfası: televizyonda yayınlandığı ülkeler ve satış kayıtları. */
export function SeriesTv({ seriesId }) {
  const { status, data } = useAsync(() => fetchSeriesTv(seriesId), [seriesId])
  const online = data?.online || []
  if (status !== 'ready' || !online.length) return null
  const name = (iso2) => countryNames[iso2]?.name || iso2
  return (
    <section className="series-page__section">
      <h2>Çevrimiçi izlenme</h2>
      <ul className="series-page__rows">
        {online.map((o) => (
          <li key={o.iso2} className="series-page__row">
            <span className="series-page__country">
              <Flag iso2={o.iso2} />
              {name(o.iso2)}
            </span>
            <span className="series-page__row-meta">
              {views(o.views)} izlenme · {o.videos} video
              {o.weeklyGain ? ` · son hafta +${views(o.weeklyGain)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Yönetim: rehber durumu, eşleşmeyen başlıkları elle bağlama, dağıtımcı satış tablosu yükleme. */
export function TvAdmin() {
  const [refresh, setRefresh] = useState(0)
  const { status, data, error } = useAsync(fetchTvAdmin, [refresh])
  const seriesReq = useAsync(fetchTrendSeriesList, [])
  const byName = useMemo(() => new Map((seriesReq.data?.items || []).map((s) => [s.name, s.id])), [seriesReq.data])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [picks, setPicks] = useState({})
  const [distributor, setDistributor] = useState('')

  async function run() {
    setBusy(true)
    try {
      const { job } = await runTvGuide()
      const r = await waitForJob(job.id)
      setMsg(
        r
          ? {
              ok: !r.errors.length,
              text: `${r.countries} ülke tarandı, ${r.series} dizi ${r.airings} kanalda bulundu.${r.errors.length ? ` Hatalar: ${r.errors.join('; ')}` : ''}`,
            }
          : { ok: true, text: 'Toplama kapalı ya da zaten sürüyor.' }
      )
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
      setRefresh((n) => n + 1)
    }
  }

  async function map(u) {
    const id = byName.get(picks[`${u.channel}|${u.title}`])
    if (!id) return setMsg({ ok: false, text: 'Listeden bir dizi seçin.' })
    try {
      await mapTvTitle({ provider: u.provider, channel: u.channel, title: u.title, seriesId: id })
      setMsg({ ok: true, text: `"${u.title}" bağlandı; sonraki toplamada yayınları yazılır.` })
      setRefresh((n) => n + 1)
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!distributor.trim()) return setMsg({ ok: false, text: 'Önce dağıtımcı adını yazın.' })
    try {
      const r = await importSalesCsv({ csv: await file.text(), distributor: distributor.trim() })
      setMsg({
        ok: r.skipped.length === 0,
        text: `${r.imported} kayıt yüklendi.${r.skipped.length ? ` Atlanan satırlar: ${r.skipped.map((s) => `${s.line} (${s.reason})`).join('; ')}` : ''}`,
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  return (
    <section className="dashboard__section">
      <h3 className="dashboard__section-title">Televizyon yayınları ve satış kayıtları</h3>
      {msg && <div className={msg.ok ? 'dashboard__bulk-bar' : 'status status--error'}>{msg.text}</div>}
      {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
      {status === 'error' && <p className="dashboard__empty">Durum alınamadı: {error}</p>}
      {status === 'ready' && (
        <>
          <p className="dashboard__hint">
            Afrika yayın akışı, günde bir kez. {data.guide.enabled ? '' : 'Toplama kapalı (TV_GUIDE_ENABLED=false). '}
            Son toplama: {data.guide.lastDate ? day(data.guide.lastDate) : '—'} · {data.guide.countries} ülke,{' '}
            {data.guide.series} dizi, {data.guide.channels} kanal.{' '}
            <button type="button" className="dashboard__link-btn" onClick={run} disabled={busy}>
              {busy ? 'Toplanıyor…' : 'Şimdi topla'}
            </button>
          </p>
          {data.guide.unmatched.length > 0 && (
            <>
              <h4 className="series-interest__title">Türk dizisi yayınlayan kanallarda eşleşmeyen başlıklar</h4>
              <datalist id="tv-series-list">
                {(seriesReq.data?.items || []).map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
              <table className="dashboard__table dashboard__table--compact">
                <thead>
                  <tr>
                    <th scope="col">Başlık</th>
                    <th scope="col">Kanal</th>
                    <th scope="col">Ülke</th>
                    <th scope="col">Diziye bağla</th>
                  </tr>
                </thead>
                <tbody>
                  {data.guide.unmatched.map((u) => {
                    const k = `${u.channel}|${u.title}`
                    return (
                      <tr key={k}>
                        <td>{u.title}</td>
                        <td>{u.channel}</td>
                        <td>{u.countries}</td>
                        <td>
                          <input
                            className="search-input"
                            list="tv-series-list"
                            aria-label={`${u.title} için dizi seç`}
                            value={picks[k] || ''}
                            onChange={(e) => setPicks((p) => ({ ...p, [k]: e.target.value }))}
                          />{' '}
                          <button type="button" className="dashboard__link-btn" onClick={() => map(u)}>
                            Bağla
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
          <h4 className="series-interest__title">Dağıtımcı satış tablosu</h4>
          <p className="dashboard__hint">
            CSV sütunları: dizi, ulke, alici, baslangic, bitis (virgül ya da noktalı virgül). Dizi adla ya da dizi
            kimliğiyle, ülke adla ya da ISO koduyla. Aynı dağıtımcının yeni dosyası eskisinin yerini alır.
          </p>
          <p>
            <input
              className="search-input"
              placeholder="Dağıtımcı adı (ör. Global Agency)"
              value={distributor}
              onChange={(e) => setDistributor(e.target.value)}
            />{' '}
            <input type="file" accept=".csv,text/csv" onChange={upload} aria-label="Satış tablosu (CSV)" />
          </p>
          {data.sales.length > 0 && (
            <table className="dashboard__table dashboard__table--compact">
              <thead>
                <tr>
                  <th scope="col">Dağıtımcı</th>
                  <th scope="col">Kayıt</th>
                  <th scope="col">Dizi</th>
                  <th scope="col">Ülke</th>
                  <th scope="col">Yükleme</th>
                </tr>
              </thead>
              <tbody>
                {data.sales.map((s) => (
                  <tr key={s.distributor}>
                    <td>{s.distributor}</td>
                    <td>{s.records}</td>
                    <td>{s.series}</td>
                    <td>{s.countries}</td>
                    <td>{new Date(s.importedAt).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
