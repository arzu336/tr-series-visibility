import { useEffect, useState } from 'react'
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
} from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
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

// Blok 1 — Dizi Başlık & Tema. /api/series/:id (poster/yıl/tema/bölüm sayısı) + /api/imdb/:id
// (puan) ayrı iki kaynak — biri yoksa/hata verirse diğeri dürüstçe kendi boş durumunu gösterir,
// birbirini bloke etmez. Google Bilgi Grafiği puanları/izleyici beğeni yüzdesi de burada — eskiden
// "Sosyal & Video Nabzı"ndaydı ama IMDb puanının hemen yanında durması daha tutarlı (kullanıcı
// geri bildirimi: "alakasız gözüküyor", tüm puan kaynakları artık tek yerde).
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

// Blok 3 (sol) — en çok arandığı ilk 8 ülke, zaten sorgulanmış result.byCountry'den (yeni bir
// istek YOK). Haritada Göster burada kalıyor çünkü tam ülke listesine (result.byCountry, 8'den
// fazla) ihtiyaç duyuyor.
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
              <div className="benchmark-card__row-label">{row.country}</div>
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

// Blok 3 (sağ) — bu dizi için o ana kadar TARANMIŞ ülkelerin basın/medya duygu dağılımı
// (getMediaSentimentForSeries, senkron SQLite okuması). "Tüm Ülkeleri Tara" aynı anda hem basın
// hem sosyal veriyi tazeler (enrichSeriesNow) — buton burada, sonucu hem bu kart hem Blok 4'ü
// etkiler, bu yüzden altında kısa bir not var.
function MediaSentimentSummaryCard({ summary, status, onScanAll, scanStatus, scanResult, scanError }) {
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

      {scanStatus === 'done' && scanResult && (
        <div className="dashboard__bulk-bar" style={{ marginTop: '0.6rem' }}>
          {scanResult.countriesTargeted} ülke hedeflendi — basın: {scanResult.news.scanned} tarandı ({scanResult.news.liveCalls} canlı),
          sosyal: {scanResult.social.scanned} tarandı ({scanResult.social.liveCalls} canlı).
          {(scanResult.news.budgetExhausted || scanResult.social.budgetExhausted) && ' Aylık SerpAPI kotası sırasında doldu.'}
        </div>
      )}
      {scanStatus === 'error' && <div className="status status--error" style={{ marginTop: '0.6rem' }}>Tarama başarısız: {scanError}</div>}
    </div>
  )
}

// Blok 4 — resmi dizi tanıtımı (YouTube). Bilgi Grafiği puanları artık Blok 1'de (kullanıcı geri
// bildirimi: burada "alakasız gözüküyordu") — bu blok artık tek amaçlı.
function SocialPulseBlock({ social }) {
  if (!social?.youtube) {
    return <p className="dashboard__empty">Bu dizi için video verisi bulunamadı.</p>
  }
  return (
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
  )
}

function SingleSeriesMode({ seriesList, onShowOnMap }) {
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState(null)
  const [social, setSocial] = useState(null)
  const [imdb, setImdb] = useState(null)
  const [imdbStatus, setImdbStatus] = useState('idle') // idle | loading | ready | unavailable
  const [status, setStatus] = useState('idle') // idle | querying | ready | error
  const [error, setError] = useState(null)
  const [timeSeries, setTimeSeries] = useState(null)
  const [timeSeriesStatus, setTimeSeriesStatus] = useState('idle') // idle | loading | ready | unavailable
  const [insight, setInsight] = useState(null)
  const [insightStatus, setInsightStatus] = useState('idle') // idle | loading | ready
  const [meta, setMeta] = useState(null)
  const [metaStatus, setMetaStatus] = useState('idle') // idle | loading | ready | error
  const [sentimentSummary, setSentimentSummary] = useState(null)
  const [sentimentStatus, setSentimentStatus] = useState('idle') // idle | loading | ready
  const [enrichStatus, setEnrichStatus] = useState('idle') // idle | running | done | error
  const [enrichResult, setEnrichResult] = useState(null)
  const [enrichError, setEnrichError] = useState(null)

  // Temiz Başlangıç: URL'de ?series= yoksa arama kutusu BOŞ gelir, placeholder ile net bir
  // seçim arayüzü sunar — daha önceki "listedeki ilk diziyi otomatik doldur" davranışı bilerek
  // kaldırıldı (kullanıcı hangi diziyi sorguladığını fark etmeden sonuç görüyordu).
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
    setImdb(null)
    setImdbStatus('idle')
    setMeta(null)
    setMetaStatus('idle')
    setSentimentSummary(null)
    setSentimentStatus('idle')
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

    setInsightStatus('loading')
    setInsight(null)
    fetchTrendsInsight(name)
      .then((data) => {
        setInsight(data)
        setInsightStatus('ready')
      })
      .catch(() => setInsightStatus('ready'))

    fetchSocialListening(name)
      .then(setSocial)
      .catch(() => {
        // Fragman/Bilgi Grafiği ikincil bilgi — bulunamazsa/erişilemezse sessizce atlanır.
      })

    const selectedId = seriesList.find((s) => s.name === name)?.id
    if (selectedId == null) return

    setMetaStatus('loading')
    fetchSeriesMeta(selectedId)
      .then((data) => {
        setMeta(data)
        setMetaStatus('ready')
      })
      .catch(() => setMetaStatus('error'))

    setImdbStatus('loading')
    fetchImdbData(selectedId)
      .then((data) => {
        setImdb(data)
        setImdbStatus(data.status)
      })
      .catch(() => setImdbStatus('unavailable'))

    setSentimentStatus('loading')
    fetchMediaSentimentSummary(selectedId)
      .then((data) => {
        setSentimentSummary(data)
        setSentimentStatus('ready')
      })
      .catch(() => setSentimentStatus('ready'))
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
      // Tarama basın + sosyal veriyi tazeledi — her iki kartı da güncel sonuçla yeniden çeker.
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
        <input
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
              />
            </div>
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Dizi Tanıtımı</h3>
            <SocialPulseBlock social={social} />
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Küresel Zaman Serisi (Son 12 Ay)</h3>
            {timeSeriesStatus === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {timeSeriesStatus === 'unavailable' && (
              <p className="dashboard__empty">Bu dizi için küresel zaman serisi verisi bulunamadı.</p>
            )}
            {timeSeriesStatus === 'ready' && (
              <>
                <SeriesTrendChart timeline={timeSeries} />
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
            <ComparisonView seriesList={seriesList} />
          )}
        </>
      )}
    </div>
  )
}
