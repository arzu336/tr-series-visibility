import { useEffect, useRef, useState } from 'react'
import { safeExternalUrl } from '../lib/safeUrl.js'
import {
  fetchTrendSeriesList,
  fetchTrends,
  fetchSocialListening,
  fetchImdbData,
  fetchTrendsTimeSeries,
  fetchTrendsInsight,
  fetchSeriesMeta,
  fetchMediaSentimentSummary,
  enrichSeriesNow,
  waitForJob,
} from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import { resolveIso2FromLabel } from '../lib/continents.js'

function ulkeAdi(deger) {
  const iso2 = resolveIso2FromLabel(deger)
  return countryNames[iso2]?.name || deger
}
import SeriesTrendChart from './SeriesTrendChart.jsx'
import CastBar from './CastBar.jsx'
import ComparisonView from './ComparisonView.jsx'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'

function formatViews(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('tr-TR').format(n)
}

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : null
}

function SeriesHeaderBlock({ meta, metaStatus, imdb, imdbStatus, social }) {
  if (metaStatus === 'loading') return <p className="dashboard__empty">Yükleniyor…</p>
  if (metaStatus === 'error' || !meta) return <p className="dashboard__empty">Dizi bilgisi alınamadı.</p>

  const kg = social?.knowledgeGraph
  const otherRatings = kg?.ratings || []
  const hasUserReviews = kg?.userReviewsPct != null

  return (
    <div className="series-header">
      <div className="series-header__top">
        {meta.posterPath ? (
          <img className="series-header__poster" src={`${POSTER_BASE}${meta.posterPath}`} alt="" />
        ) : (
          <div className="series-header__poster series-header__poster--empty">Afiş yok</div>
        )}
        <div>
          <h3 className="series-header__title">{meta.name}</h3>
          <div className="series-header__meta">
            {yearOf(meta.firstAirDate) && <span><strong>{yearOf(meta.firstAirDate)}</strong></span>}
            <span>{meta.totalEpisodes != null ? <><strong>{meta.totalEpisodes}</strong> bölüm</> : 'Bölüm sayısı bilinmiyor'}</span>
            <span>
              {imdbStatus === 'loading' && 'Puan yükleniyor…'}
              {imdbStatus === 'ready' && imdb?.rating != null && (
                <>⭐ <strong>{imdb.rating.toFixed(1)}/10</strong> ({formatViews(imdb.votes)} oy)</>
              )}
              {imdbStatus === 'ready' && imdb?.rating == null && 'Puan verisi yok'}
              {imdbStatus === 'unavailable' && 'Puan verisi yok'}
            </span>
            {hasUserReviews && <span>İzleyici Beğenisi: <strong>%{kg.userReviewsPct}</strong></span>}
            {otherRatings.map((r) => (
              <span key={r.source}>{r.source}: <strong>{r.rating}</strong></span>
            ))}
          </div>
          <div className="series-header__themes">
            {meta.theme ? <span className="badge badge--theme">{meta.theme}</span> : <span className="badge badge--uncertain">Tema sınıflandırılmamış</span>}
          </div>
          {meta.overview && <p className="series-header__overview">{meta.overview}</p>}
        </div>
      </div>
      {meta.cast?.length > 0 && (
        <div className="series-header__cast">
          <h4 className="subcard__title">Oyuncular</h4>
          <CastBar cast={meta.cast} />
        </div>
      )}
    </div>
  )
}

function GlobalFootprintCard({ result, seriesId, onShowOnMap }) {
  const byCountry = result?.byCountry
  const withInterest = [...(byCountry || [])].filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  if (withInterest.length === 0) {
    return (
      <div className="subcard">
        <h4 className="subcard__title">Küresel Ayak İzi — İlk 8 Ülke</h4>
        <p className="dashboard__empty">Bu dizi için ülke bazlı arama ilgisi verisi bulunamadı.</p>
      </div>
    )
  }
  const top8 = withInterest.slice(0, 8)
  const maxValue = top8[0].value

  return (
    <div className="subcard">
      <h4 className="subcard__title">Küresel Ayak İzi — İlk 8 Ülke</h4>
      <div className="benchmark-card">
        <div className="benchmark-card__bars">
          {top8.map((row) => (
            <div key={row.country} className="benchmark-card__row">
              <div className="benchmark-card__row-label">{ulkeAdi(row.country)}</div>
              <div className="benchmark-card__row-bar-track">
                <div className="benchmark-card__row-bar" style={{ width: `${(row.value / maxValue) * 100}%`, background: '#EE3135' }} />
              </div>
              <div className="benchmark-card__row-value">{row.value}</div>
            </div>
          ))}
        </div>
      </div>
      {withInterest.length > 8 && (
        <div className="map-cta">
          <div className="map-cta__text">
            <strong>{withInterest.length} ülkede arama ilgisi ölçüldü</strong>
            <span>Haritayı bu dizinin ilgi dağılımına göre boyar, sağ panelde kadro/yayın bilgisini açar.</span>
          </div>
          <button className="map-cta__btn" onClick={() => onShowOnMap?.({ ...result, seriesId })}>
            🗺️ Haritada Göster
          </button>
        </div>
      )}
    </div>
  )
}

function ToneBadge({ tone }) {
  if (tone === 'positive') return <span className="badge badge--ok">Olumlu</span>
  if (tone === 'negative') return <span className="badge badge--uncertain">Olumsuz</span>
  return <span className="badge badge--info">Nötr</span>
}

function scanProgressText(p) {
  if (!p) return 'Tarama sıraya alındı…'
  if (p.phase === 'social') return 'Basın tarandı, sosyal/YouTube verisi çekiliyor…'
  const oran = p.total ? ` (${p.done}/${p.total}${p.current ? ` · ${p.current}` : ''})` : ''
  return `Basın taranıyor${oran} — her ülke için ~20 sn bekleme var, sayfadan ayrılabilirsiniz.`
}

function MediaSentimentSummaryCard({ summary, status, onScanAll, scanStatus, scanResult, scanError, scanProgress }) {
  return (
    <div className="subcard">
      <h4 className="subcard__title">Medya &amp; Basın Algısı</h4>

      {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}

      {status === 'ready' && summary?.status === 'pending' && (
        <p className="dashboard__empty">Bu dizi için henüz hiçbir ülkede basın taraması yapılmadı.</p>
      )}
      {status === 'ready' && summary?.status === 'no-data' && (
        <p className="dashboard__empty">
          {summary.scannedCount} ülke tarandı ama hiçbirinde haber bulunamadı.
        </p>
      )}
      {status === 'ready' && summary?.status === 'ready' && (
        <>
          <div className="series-header__themes" style={{ marginBottom: '0.7rem' }}>
            <ToneBadge tone={summary.dominantTone} />
            <span className="badge badge--info" title="Taranmış ülke sayısı — istatistiksel bir örneklem değil">
              {summary.withDataCount}/{summary.scannedCount} ülkede veri
            </span>
          </div>
          <ul className="panel__series-list">
            {summary.countries
              .filter((c) => c.dominantSentiment !== 'yetersiz-veri')
              .map((c) => (
                <li key={c.iso2} className="panel__series-item">
                  <div className="panel__series-row">
                    <span className="panel__series-info"><span className="panel__series-name">{countryNames[c.iso2]?.name || c.iso2}</span></span>
                    <span className="panel__series-score">%{c.positivePct} olumlu</span>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      <div className="scan-cta">
        <div className="scan-cta__text">
          <strong>Daha fazla ülke mi taransın?</strong>
          <span>En görünür 15 ülkede basın + sosyal/YouTube verisini birlikte tazeler.</span>
        </div>
        <button className="scan-cta__btn" onClick={onScanAll} disabled={scanStatus === 'running'}>
          {scanStatus === 'running' ? 'Taranıyor…' : '🔎 Tüm Ülkeleri Tara'}
        </button>
      </div>

      {scanStatus === 'running' && (
        <div className="dashboard__hint" style={{ marginTop: '0.6rem' }} role="status">
          {scanProgressText(scanProgress)}
        </div>
      )}
      {scanStatus === 'done' && scanResult && (
        <div className="dashboard__bulk-bar" style={{ marginTop: '0.6rem' }}>
          {scanResult.countriesTargeted} ülke hedeflendi — basın: {scanResult.news.scanned} tarandı ({scanResult.news.liveCalls} canlı),
          sosyal: {scanResult.social.scanned} tarandı ({scanResult.social.liveCalls} canlı).
          {/* Denetim raporu D.6: basın taraması artık ücretsiz GDELT'e gittiği için SerpAPI
              kotasına TABİ DEĞİL — `news.budgetExhausted` alanı da kaldırıldı. Bu uyarı yalnızca
              hâlâ SerpAPI kullanan sosyal tarama (YouTube + Bilgi Grafiği) için geçerli. */}
          {scanResult.social.budgetExhausted && ' Sosyal tarama sırasında aylık SerpAPI kotası doldu (basın taraması ücretsiz kaynaktan sürer).'}
        </div>
      )}
      {scanStatus === 'error' && <div className="status status--error" style={{ marginTop: '0.6rem' }}>Tarama başarısız: {scanError}</div>}
    </div>
  )
}

function SocialPulseBlock({ social }) {
  if (!social?.youtube) {
    return <p className="dashboard__empty">Bu dizi için video verisi bulunamadı.</p>
  }
  const videoUrl = safeExternalUrl(social.youtube.link)
  return (
    <p className="dashboard__hint" style={{ margin: 0 }}>
      {videoUrl ? (
        <a href={videoUrl} target="_blank" rel="noreferrer" className="dashboard__link-btn">
          {social.youtube.title}
        </a>
      ) : (
        <strong>{social.youtube.title}</strong>
      )}
      {' — '}
      {social.youtube.channel || 'Bilinmeyen kanal'}
      {social.youtube.channelVerified && ' ✓'}
      {' · '}
      {formatViews(social.youtube.views)} izlenme
      {social.youtube.publishedDate && ` · ${social.youtube.publishedDate}`}
    </p>
  )
}

function TimeSeriesScopePicker({ byCountry, value, onChange, disabled }) {
  const ulkeler = [...(byCountry || [])]
    .filter((row) => row.value > 0)
    .map((row) => ({ iso2: resolveIso2FromLabel(row.country), value: row.value }))
    .filter((row) => row.iso2)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)

  return (
    <div className="ts-scope">
      <span className="ts-scope__label">Kapsam:</span>
      <div className="ts-scope__chips">
        <button
          type="button"
          className={`ts-scope__chip${value === null ? ' ts-scope__chip--active' : ''}`}
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-pressed={value === null}
        >
          🌍 Küresel
        </button>
        {ulkeler.map((row) => (
          <button
            key={row.iso2}
            type="button"
            className={`ts-scope__chip${value === row.iso2 ? ' ts-scope__chip--active' : ''}`}
            onClick={() => onChange(row.iso2)}
            disabled={disabled}
            aria-pressed={value === row.iso2}
          >
            {ulkeAdi(row.iso2)}
          </button>
        ))}
      </div>
    </div>
  )
}

function SingleSeriesMode({ seriesList, onShowOnMap }) {
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [social, setSocial] = useState(null)
  const [imdb, setImdb] = useState(null)
  const [imdbStatus, setImdbStatus] = useState('idle')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [timeSeries, setTimeSeries] = useState(null)
  const [timeSeriesStatus, setTimeSeriesStatus] = useState('idle')
  const [insight, setInsight] = useState(null)
  const [insightStatus, setInsightStatus] = useState('idle')
  const [tsGeo, setTsGeo] = useState(null)
  const [queriedName, setQueriedName] = useState(null)
  const [timeSeriesError, setTimeSeriesError] = useState(null)
  const [meta, setMeta] = useState(null)
  const [metaStatus, setMetaStatus] = useState('idle')
  const [sentimentSummary, setSentimentSummary] = useState(null)
  const [sentimentStatus, setSentimentStatus] = useState('idle')
  const [enrichStatus, setEnrichStatus] = useState('idle')
  const [enrichResult, setEnrichResult] = useState(null)
  const [enrichError, setEnrichError] = useState(null)
  const [enrichProgress, setEnrichProgress] = useState(null)

  useEffect(() => {
    if (seriesList.length === 0) return
    const fromUrl = new URLSearchParams(window.location.search).get('series')
    if (fromUrl && seriesList.some((s) => s.name === fromUrl)) {
      setSelected(fromUrl)
      handleQuery(fromUrl)
      window.history.replaceState(null, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesList])

  const queryTokenRef = useRef(0)

  const tsTokenRef = useRef(0)

  const loadTimeSeries = (name, iso2) => {
    const token = ++tsTokenRef.current
    const isStaleTs = () => tsTokenRef.current !== token

    setTimeSeriesStatus('loading')
    setTimeSeries(null)
    setTimeSeriesError(null)
    fetchTrendsTimeSeries(name, iso2)
      .then((data) => {
        if (isStaleTs()) return
        setTimeSeries(data.timeline)
        setTimeSeriesStatus(data.timeline?.length > 1 ? 'ready' : 'unavailable')
      })
      .catch((err) => {
        if (isStaleTs()) return
        setTimeSeriesError(err.message || null)
        setTimeSeriesStatus('unavailable')
      })

    setInsightStatus('loading')
    setInsight(null)
    fetchTrendsInsight(name, iso2)
      .then((data) => {
        if (isStaleTs()) return
        setInsight(data)
        setInsightStatus('ready')
      })
      .catch(() => {
        if (!isStaleTs()) setInsightStatus('ready')
      })
  }

  const handleGeoChange = (iso2) => {
    if (iso2 === tsGeo) return
    setTsGeo(iso2)
    if (queriedName) loadTimeSeries(queriedName, iso2)
  }

  const handleQuery = async (seriesName) => {
    const name = seriesName ?? selected
    if (!name) return
    const token = ++queryTokenRef.current
    const isStale = () => queryTokenRef.current !== token
    setStatus('querying')
    setError(null)
    setSocial(null)
    setImdb(null)
    setImdbStatus('idle')
    setMeta(null)
    setMetaStatus('idle')
    setSentimentSummary(null)
    setSentimentStatus('idle')
    setEnrichStatus('idle')
    setEnrichResult(null)
    setEnrichError(null)
    setTsGeo(null)
    setQueriedName(name)
    try {
      const data = await fetchTrends(name)
      if (isStale()) return
      setResult(data)
      setStatus('ready')
    } catch (err) {
      if (isStale()) return
      setError(err.message)
      setStatus('error')
      return
    }
    if (isStale()) return

    loadTimeSeries(name, null)

    fetchSocialListening(name)
      .then((data) => {
        if (!isStale()) setSocial(data)
      })
      .catch(() => {
      })

    const selectedId = seriesList.find((s) => s.name === name)?.id
    if (selectedId == null) return

    setMetaStatus('loading')
    fetchSeriesMeta(selectedId)
      .then((data) => {
        if (isStale()) return
        setMeta(data)
        setMetaStatus('ready')
      })
      .catch(() => {
        if (!isStale()) setMetaStatus('error')
      })

    setImdbStatus('loading')
    fetchImdbData(selectedId)
      .then((data) => {
        if (isStale()) return
        setImdb(data)
        setImdbStatus(data.status)
      })
      .catch(() => {
        if (!isStale()) setImdbStatus('unavailable')
      })

    setSentimentStatus('loading')
    fetchMediaSentimentSummary(selectedId)
      .then((data) => {
        if (isStale()) return
        setSentimentSummary(data)
        setSentimentStatus('ready')
      })
      .catch(() => {
        if (!isStale()) setSentimentStatus('ready')
      })
  }

  const selectedId = seriesList.find((s) => s.name === selected)?.id

  async function handleEnrichNow() {
    if (selectedId == null) return
    setEnrichStatus('running')
    setEnrichError(null)
    setEnrichProgress(null)
    try {
      const { job } = await enrichSeriesNow(selectedId)
      const data = await waitForJob(job.id, { onProgress: (j) => setEnrichProgress(j.progress) })
      setEnrichResult(data)
      setEnrichStatus('done')
      fetchMediaSentimentSummary(selectedId).then(setSentimentSummary).catch(() => {})
      fetchSocialListening(selected).then(setSocial).catch(() => {})
    } catch (err) {
      setEnrichError(err.message)
      setEnrichStatus('error')
    }
  }

  return (
    <div>
      <div className="trends__controls">
        <input aria-label="Bir dizi ara ve seç"
          className="search-input"
          list="trends-series-list"
          type="text"
          placeholder="Bir dizi ara ve seç…"
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
      </div>

      {status === 'idle' && <p className="dashboard__empty">Bir dizi seç ve "Sorgula"ya bas — sonuçlar burada görünecek.</p>}
      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {status === 'ready' && (
        <>
          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Dizi Başlık &amp; Tema</h3>
            <SeriesHeaderBlock meta={meta} metaStatus={metaStatus} imdb={imdb} imdbStatus={imdbStatus} social={social} />
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Küresel Ayak İzi &amp; Medya Algısı</h3>
            <div className="two-col-grid">
              <GlobalFootprintCard result={result} seriesId={selectedId} onShowOnMap={onShowOnMap} />
              <MediaSentimentSummaryCard
                summary={sentimentSummary}
                status={sentimentStatus}
                onScanAll={handleEnrichNow}
                scanStatus={enrichStatus}
                scanResult={enrichResult}
                scanError={enrichError}
                scanProgress={enrichProgress}
              />
            </div>
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Dizi Tanıtımı</h3>
            <SocialPulseBlock social={social} />
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">
              Zaman Serisi (Son 12 Ay) — {tsGeo ? ulkeAdi(tsGeo) : 'Küresel'}
            </h3>
            <TimeSeriesScopePicker
              byCountry={result?.byCountry}
              value={tsGeo}
              onChange={handleGeoChange}
              disabled={timeSeriesStatus === 'loading'}
            />
            {timeSeriesStatus === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {timeSeriesStatus === 'unavailable' && (
              <p className="dashboard__empty">
                {timeSeriesError
                  ? timeSeriesError
                  : `Bu dizi için ${tsGeo ? `${ulkeAdi(tsGeo)} bazlı` : 'küresel'} zaman serisi verisi bulunamadı.`}
              </p>
            )}
            {timeSeriesStatus === 'ready' && (
              <>
                <SeriesTrendChart timeline={timeSeries} scopeLabel={tsGeo ? ulkeAdi(tsGeo) : null} />
                <p className="ts-scope__note">
                  Google Trends 0-100 ölçeği <strong>her kapsam için kendi içinde bağıldır</strong>: bu
                  grafik {tsGeo ? `${ulkeAdi(tsGeo)} içindeki` : 'dünya genelindeki'} zaman yönünü gösterir,
                  ülkeler arası mutlak hacim karşılaştırması için kullanılamaz.
                </p>
                {insightStatus === 'loading' && <p className="dashboard__empty" style={{ marginTop: '0.6rem' }}>Yapay zeka yorumu hazırlanıyor…</p>}
                {insightStatus === 'ready' && insight?.insightText && (
                  <div className="theme-insight__ai-box" style={{ marginTop: '0.8rem' }}>
                    <span className="theme-insight__ai-label">🤖 Yapay Zeka</span>
                    <p>{insight.insightText}</p>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default function TrendsExplorer({ onShowOnMap }) {
  const [seriesList, setSeriesList] = useState([])
  const [listStatus, setListStatus] = useState('loading')
  const [listError, setListError] = useState(null)
  const [mode, setMode] = useState('single')

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
            <ComparisonView seriesList={seriesList} />
          )}
        </>
      )}
    </div>
  )
}
