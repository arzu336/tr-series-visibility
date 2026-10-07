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

// Televizyon yayınları (izinli DStv rehberi, Afrika) ve dağıtımcı satış kayıtları: ülke paneli, dizi sayfası,
// yönetim ekranı. Veri yoksa bölümler görünmez.

const day = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '')
const period = (s, e) => [s, e].filter(Boolean).join(' – ')

/**
 * Ülke paneli: son 30 günde televizyonda yayınlanan Türk dizileri ve satış kayıtları — paneldeki diğer listelerle
 * aynı afişli liste. `seriesInfo`: dizi kimliği → { name, posterPath } (haritanın yüklediği katalogdan).
 */
export function CountryTv({ iso2, seriesInfo, onSelectSeries }) {
  const { status, data } = useAsync(() => fetchCountryTv(iso2), [iso2])
  if (status !== 'ready' || (!data.airings.length && !data.sales.length)) return null
  const info = (id, fallback) => ({
    name: seriesInfo.get(id)?.name || fallback || `#${id}`,
    posterPath: seriesInfo.get(id)?.posterPath,
  })
  return (
    <>
      {data.airings.length > 0 && (
        <>
          <h3>Televizyonda — son 30 gün</h3>
          <ChartList
            compact
            showPosters
            items={data.airings.map((a, i) => {
              const s = info(a.seriesId, a.localTitle)
              return {
                rank: i + 1,
                seriesId: a.seriesId,
                kind: 'series',
                ...s,
                meta: [
                  a.localTitle !== s.name ? `"${a.localTitle}"` : null,
                  a.channels.join(', '),
                  `${a.slots} yayın`,
                  `son ${day(a.last)}`,
                ]
                  .filter(Boolean)
                  .join(' · '),
              }
            })}
            onSelect={onSelectSeries}
          />
        </>
      )}
      {data.sales.length > 0 && (
        <>
          <h3>Satış kayıtları</h3>
          <ChartList
            compact
            showPosters
            items={data.sales.map((x, i) => ({
              rank: i + 1,
              seriesId: x.seriesId,
              kind: 'series',
              ...info(x.seriesId),
              meta: [x.buyer, x.distributor, period(x.start, x.end) || null].filter(Boolean).join(' · '),
            }))}
            onSelect={onSelectSeries}
          />
        </>
      )}
    </>
  )
}

/** Dizi sayfası: televizyonda yayınlandığı ülkeler ve satış kayıtları. */
export function SeriesTv({ seriesId }) {
  const { status, data } = useAsync(() => fetchSeriesTv(seriesId), [seriesId])
  if (status !== 'ready' || (!data.airings.length && !data.sales.length)) return null
  const name = (iso2) => countryNames[iso2]?.name || iso2
  return (
    <section className="series-page__section">
      <h2>Televizyonda</h2>
      {data.airings.length > 0 && (
        <>
          <p className="dashboard__hint">Son 30 günde yayınlandığı ülkeler (Afrika uydu ve kablo rehberi).</p>
          <ul className="series-page__rows">
            {data.airings.map((a) => (
              <li key={a.iso2} className="series-page__row">
                <span className="series-page__country">
                  <Flag iso2={a.iso2} />
                  {name(a.iso2)}
                </span>
                <span className="series-page__row-meta">
                  {a.channels.join(', ')} · {a.slots} yayın{a.localTitle ? ` · "${a.localTitle}"` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.sales.length > 0 && (
        <>
          <h3 className="series-interest__title">Satış kayıtları</h3>
          <ul className="series-page__rows">
            {data.sales.map((s, i) => (
              <li key={i} className="series-page__row">
                <span className="series-page__country">
                  <Flag iso2={s.iso2} />
                  {name(s.iso2)}
                </span>
                <span className="series-page__row-meta">
                  {s.buyer} · {s.distributor}
                  {period(s.start, s.end) ? ` · ${period(s.start, s.end)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
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
            Afrika uydu ve kablo rehberi (DStv, 49 ülke), günde bir kez.{' '}
            {data.guide.enabled ? '' : 'Toplama kapalı (TV_GUIDE_ENABLED=false). '}
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
            CSV sütunları: dizi, ulke, alici, baslangic, bitis (virgül ya da noktalı virgül). Dizi adla ya da TMDB
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
