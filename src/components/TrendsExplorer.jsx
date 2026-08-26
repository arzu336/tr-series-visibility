import { useEffect, useState } from 'react'
import {
  fetchTrendSeriesList,
  fetchTrends,
  fetchSocialListening,
  fetchImdbData,
  fetchShareOfSearch,
  fetchTrendsTimeSeries,
  enrichSeriesNow,
} from '../lib/api.js'
import ShareOfSearchChart from './ShareOfSearchChart.jsx'
import SeriesTrendChart from './SeriesTrendChart.jsx'

const MAX_COMPARE = 3

function formatViews(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('tr-TR').format(n)
}

function ComparisonMode({ seriesList }) {
  const [picked, setPicked] = useState([])
  const [status, setStatus] = useState('idle') // idle | querying | ready | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  function togglePick(name) {
    setPicked((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, name]
    })
  }

  async function handleCompare() {
    setStatus('querying')
    setError(null)
    try {
      const data = await fetchShareOfSearch(picked)
      setResult(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  return (
    <div>
      <p className="dashboard__hint">
        En fazla {MAX_COMPARE} dizi seçip aralarındaki göreceli arama payını (Share of Search) tek bir
        sorguda kıyasla — küresel, aynı 12 aylık dönem.
      </p>
      <div className="compare-picker">
        {seriesList.map((s) => {
          const isPicked = picked.includes(s.name)
          const disabled = !isPicked && picked.length >= MAX_COMPARE
          return (
            <label key={s.id} className={disabled ? 'compare-picker__item compare-picker__item--disabled' : 'compare-picker__item'}>
              <input type="checkbox" checked={isPicked} disabled={disabled} onChange={() => togglePick(s.name)} />
              {s.name}
            </label>
          )
        })}
      </div>
      <div className="trends__controls">
        <button onClick={handleCompare} disabled={picked.length < 2 || status === 'querying'}>
          {status === 'querying' ? 'Karşılaştırılıyor…' : `Karşılaştır (${picked.length}/${MAX_COMPARE})`}
        </button>
        {picked.length === 1 && <span className="dashboard__hint" style={{ margin: 0 }}>En az 2 dizi seçmelisin.</span>}
      </div>

      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {status === 'ready' && result && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Göreceli Arama Payı (Share of Search)</h3>
          <ShareOfSearchChart items={result.items} />
        </section>
      )}
    </div>
  )
}

function SingleSeriesMode({ seriesList, onShowOnMap }) {
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [social, setSocial] = useState(null)
  const [imdb, setImdb] = useState(null)
  const [imdbError, setImdbError] = useState(null)
  const [status, setStatus] = useState('idle') // idle | querying | ready | error
  const [error, setError] = useState(null)
  const [timeSeries, setTimeSeries] = useState(null)
  const [timeSeriesStatus, setTimeSeriesStatus] = useState('idle') // idle | loading | ready | unavailable
  const [enrichStatus, setEnrichStatus] = useState('idle') // idle | running | done | error
  const [enrichResult, setEnrichResult] = useState(null)
  const [enrichError, setEnrichError] = useState(null)

  useEffect(() => {
    if (seriesList.length > 0 && !selected) {
      setSelected(seriesList[0].name)
    }
  }, [seriesList, selected])

  // Harita üzerindeki "Dizi Analizine Git" bağlantısı (?series=Yargı) — sadece seriesList
  // yüklendiğinde ve gerçekten listede olan bir dizi ise otomatik seçip sorgular.
  useEffect(() => {
    if (seriesList.length === 0) return
    const fromUrl = new URLSearchParams(window.location.search).get('series')
    if (fromUrl && seriesList.some((s) => s.name === fromUrl)) {
      setSelected(fromUrl)
      handleQuery(fromUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesList])

  const handleQuery = async (seriesName) => {
    const name = seriesName ?? selected
    if (!name) return
    setStatus('querying')
    setError(null)
    setSocial(null)
    setImdbError(null)
    setImdb(null)
    setEnrichStatus('idle')
    setEnrichResult(null)
    setEnrichError(null)
    try {
      const data = await fetchTrends(name)
      setResult(data)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
      return
    }
    setTimeSeriesStatus('loading')
    setTimeSeries(null)
    fetchTrendsTimeSeries(name)
      .then((data) => {
        setTimeSeries(data.timeline)
        setTimeSeriesStatus(data.timeline?.length > 1 ? 'ready' : 'unavailable')
      })
      .catch(() => setTimeSeriesStatus('unavailable'))
    try {
      const socialData = await fetchSocialListening(name)
      setSocial(socialData)
    } catch {
      // Fragman ikincil bir bilgi — bulunamazsa/erişilemezse sessizce atlanır.
    }
    const selectedId = seriesList.find((s) => s.name === name)?.id
    if (selectedId != null) {
      try {
        const imdbData = await fetchImdbData(selectedId)
        setImdb(imdbData)
      } catch (err) {
        setImdbError(err.message)
      }
    }
  }

  const selectedId = seriesList.find((s) => s.name === selected)?.id

  async function handleEnrichNow() {
    if (selectedId == null) return
    setEnrichStatus('running')
    setEnrichError(null)
    try {
      const data = await enrichSeriesNow(selectedId)
      setEnrichResult(data)
      setEnrichStatus('done')
    } catch (err) {
      setEnrichError(err.message)
      setEnrichStatus('error')
    }
  }

  return (
    <div>
      <div className="trends__controls">
        <input
          className="search-input"
          list="trends-series-list"
          type="text"
          placeholder="Dizi ara..."
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        />
        <datalist id="trends-series-list">
          {seriesList.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <button onClick={() => handleQuery()} disabled={status === 'querying' || !seriesList.some((s) => s.name === selected)}>
          {status === 'querying' ? 'Sorgulanıyor…' : 'Sorgula'}
        </button>
        {selectedId != null && status === 'ready' && (
          <button onClick={handleEnrichNow} disabled={enrichStatus === 'running'} title="Bu dizi için basın taraması ve sosyal/YouTube verisini en görünür 15 ülkede anlık tazeler">
            {enrichStatus === 'running' ? 'Taranıyor…' : '🔎 Gelişmiş Medya & Sosyal Taramayı Çalıştır'}
          </button>
        )}
      </div>

      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {enrichStatus === 'done' && enrichResult && (
        <div className="dashboard__bulk-bar">
          "{enrichResult.seriesName}" için {enrichResult.countriesTargeted} ülke hedeflendi — basın:{' '}
          {enrichResult.news.scanned} tarandı ({enrichResult.news.liveCalls} canlı), sosyal:{' '}
          {enrichResult.social.scanned} tarandı ({enrichResult.social.liveCalls} canlı).
          {(enrichResult.news.budgetExhausted || enrichResult.social.budgetExhausted) && ' Aylık SerpAPI kotası sırasında doldu, kalan ülkeler atlandı.'}
        </div>
      )}
      {enrichStatus === 'error' && <div className="status status--error">Tarama başarısız: {enrichError}</div>}

      {(imdbError || imdb) && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Puan Verisi</h3>
          {imdbError && <p className="dashboard__empty">Veri alınamadı: {imdbError}</p>}
          {imdb && (
            imdb.status === 'ready' ? (
              <ul className="panel__series-list">
                <li className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info"><span className="panel__series-name">Puan</span></span>
                    <span className="panel__series-score">
                      {imdb.rating != null ? `⭐ ${imdb.rating.toFixed(1)}/10` : '—'}
                      {imdb.votes != null ? ` (${formatViews(imdb.votes)} oy)` : ''}
                    </span>
                  </div>
                </li>
                <li className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info"><span className="panel__series-name">Ana Karakterler</span></span>
                    <span className="panel__series-score">
                      {imdb.topCast?.length > 0 ? imdb.topCast.join(', ') : '—'}
                    </span>
                  </div>
                </li>
              </ul>
            ) : (
              <p className="dashboard__empty">Veri güncelleniyor…</p>
            )
          )}

          {social?.youtube && (
            <>
              <h4 className="impact__rank-title" style={{ marginTop: '1.25rem' }}>Fragman</h4>
              <p className="dashboard__hint" style={{ margin: 0 }}>
                <a href={social.youtube.link} target="_blank" rel="noreferrer" className="dashboard__link-btn">
                  {social.youtube.title}
                </a>
                {' — '}
                {social.youtube.channel || 'Bilinmeyen kanal'}
                {social.youtube.channelVerified && ' ✓'}
                {' · '}
                {formatViews(social.youtube.views)} izlenme
                {social.youtube.publishedDate && ` · ${social.youtube.publishedDate}`}
              </p>
            </>
          )}
        </section>
      )}

      {result && (
        <section className="dashboard__section">
          <div className="dashboard__header-row">
            <h3 className="dashboard__section-title">Ülke Bazlı Arama İlgisi</h3>
            {result.byCountry.length > 0 && (
              <button className="dashboard__export-btn dashboard__export-btn--ghost" onClick={() => onShowOnMap?.(result)}>
                🗺️ Haritada Göster
              </button>
            )}
          </div>
          {(() => {
            const withInterest = result.byCountry.filter((row) => row.value > 0)
            return withInterest.length === 0 ? (
              <p className="dashboard__empty">Bu dizi için ülke bazlı arama ilgisi verisi bulunamadı.</p>
            ) : (
              <table className="dashboard__table">
                <thead>
                  <tr>
                    <th>Ülke</th>
                    <th>Arama İlgisi (0-100)</th>
                  </tr>
                </thead>
                <tbody>
                  {withInterest.map((row) => (
                    <tr key={row.country}>
                      <td>{row.country}</td>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </section>
      )}

      {result && (
        <section className="dashboard__section">
          <h3 className="dashboard__section-title">Küresel Zaman Serisi (Son 12 Ay)</h3>
          {timeSeriesStatus === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
          {timeSeriesStatus === 'unavailable' && (
            <p className="dashboard__empty">Bu dizi için küresel zaman serisi verisi bulunamadı.</p>
          )}
          {timeSeriesStatus === 'ready' && <SeriesTrendChart timeline={timeSeries} />}
        </section>
      )}
    </div>
  )
}

export default function TrendsExplorer({ onShowOnMap }) {
  const [seriesList, setSeriesList] = useState([])
  const [listStatus, setListStatus] = useState('loading')
  const [listError, setListError] = useState(null)
  const [mode, setMode] = useState('single') // single | compare

  useEffect(() => {
    fetchTrendSeriesList()
      .then((data) => {
        setSeriesList(data.items)
        setListStatus('idle')
      })
      .catch((err) => {
        setListError(err.message)
        setListStatus('error')
      })
  }, [])

  return (
    <div className="dashboard">
      <h2>Dizi Derin Analiz &amp; Karşılaştırma Laboratuvarı</h2>
      <p className="dashboard__hint">Talep üzerine sorgulanır, sonuç kalıcı olarak önbelleklenir.</p>

      {listStatus === 'error' && <div className="status status--error">Hata: {listError}</div>}

      {listStatus !== 'error' && (
        <>
          <div className="period-toggle" role="group" aria-label="Analiz modu">
            <button
              className={mode === 'single' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
              onClick={() => setMode('single')}
            >
              Tekli Analiz
            </button>
            <button
              className={mode === 'compare' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
              onClick={() => setMode('compare')}
            >
              Kıyaslama Modu
            </button>
          </div>

          {mode === 'single' ? (
            <SingleSeriesMode seriesList={seriesList} onShowOnMap={onShowOnMap} />
          ) : (
            <ComparisonMode seriesList={seriesList} />
          )}
        </>
      )}
    </div>
  )
}
