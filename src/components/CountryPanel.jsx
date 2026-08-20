import { useEffect, useMemo, useState } from 'react'
import Sparkline from './Sparkline.jsx'
import CastBar from './CastBar.jsx'
import ActorPanel from './ActorPanel.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import { fetchRegionalInterest, fetchCountryPeriods } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PeriodChart from './PeriodChart.jsx'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w92'
const MIN_QUERY_LENGTH = 2
const MAX_RESULTS_PER_GROUP = 6

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : null
}

// Best-effort bölgesel ilgi kırılımı (server/regional-interest.js) — şehir koordinatı/
// geocoding veritabanımız olmadığı için haritada pin olarak değil, burada sıralı bir liste
// olarak gösterilir. Google Trends bazı ülke/dizi kombinasyonlarında hiç veri döndürmeyebilir
// — bu durumda dürüstçe boş durum gösterilir, uydurma bir şehir listesi üretilmez.
function RegionalInterest({ seriesName, iso2 }) {
  const [state, setState] = useState({ status: 'loading', byRegion: [] })

  useEffect(() => {
    if (!seriesName || !iso2) return
    let cancelled = false
    setState({ status: 'loading', byRegion: [] })
    fetchRegionalInterest(seriesName, iso2)
      .then((res) => {
        if (cancelled) return
        setState({ status: res.byRegion?.length > 0 ? 'ready' : 'unavailable', byRegion: res.byRegion || [] })
      })
      .catch(() => {
        if (cancelled) return
        setState({ status: 'unavailable', byRegion: [] })
      })
    return () => {
      cancelled = true
    }
  }, [seriesName, iso2])

  if (state.status === 'loading') return <p className="dashboard__empty">Yükleniyor…</p>
  if (state.status === 'unavailable') {
    return <p className="dashboard__empty">Bu ülke/dizi için bölgesel arama ilgisi verisi bulunamadı.</p>
  }

  const top = state.byRegion.slice(0, 8)
  const maxValue = Math.max(...top.map((r) => r.value), 1)

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {top.map((r) => (
          <div key={r.region} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{r.region}</div>
            <div className="benchmark-card__row-bar-track">
              <div className="benchmark-card__row-bar" style={{ width: `${(r.value / maxValue) * 100}%`, background: '#3987e5' }} />
            </div>
            <div className="benchmark-card__row-value">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Harita üzerinde her zaman erişilebilir canlı dizi/oyuncu/ülke arama barı — yeni bir uç
// noktaya ihtiyaç yok, zaten App.jsx'te yüklü olan `allCountries` (her ülkenin tam
// seriesList + her dizinin cast'i) üzerinden client-side bir indeks kurup gerçek,
// halihazırda çekilmiş veride arama yapar. Panelin daralıp genişlemesinden bağımsız
// olması için CountryPanel'in `.panel-wrap`'inin DIŞINDA, kendi konumunda render edilir
// (bkz. CountryPanel'in return'ü) — panel kapalıyken bile aramaya erişilebilsin diye.
function PanelSearch({ allCountries, onSelectActor, onSelectSeriesGlobal, onSelectCountry }) {
  const [query, setQuery] = useState('')

  const { actorIndex, seriesIndex, countryIndex } = useMemo(() => {
    const actors = new Map()
    const series = new Map()
    const countryList = []
    for (const c of allCountries || []) {
      countryList.push({ iso2: c.iso2, name: countryNames[c.iso2]?.name || c.iso2 })
      for (const s of c.seriesList || []) {
        if (!series.has(s.id)) series.set(s.id, { id: s.id, name: s.name, posterPath: s.posterPath })
        for (const actor of s.cast || []) {
          if (!actors.has(actor.id)) {
            actors.set(actor.id, { id: actor.id, name: actor.name, profilePath: actor.profilePath, seriesNames: new Set() })
          }
          actors.get(actor.id).seriesNames.add(s.name)
        }
      }
    }
    return { actorIndex: actors, seriesIndex: series, countryIndex: countryList }
  }, [allCountries])

  const trimmed = query.trim().toLowerCase()
  const showResults = trimmed.length >= MIN_QUERY_LENGTH
  const countryResults = showResults
    ? countryIndex.filter((c) => c.name.toLowerCase().includes(trimmed)).slice(0, MAX_RESULTS_PER_GROUP)
    : []
  const actorResults = showResults
    ? Array.from(actorIndex.values())
        .filter((a) => a.name.toLowerCase().includes(trimmed))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []
  const seriesResults = showResults
    ? Array.from(seriesIndex.values())
        .filter((s) => s.name.toLowerCase().includes(trimmed))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []
  const hasResults = countryResults.length > 0 || actorResults.length > 0 || seriesResults.length > 0

  return (
    <div className="panel-search">
      <input
        type="text"
        className="panel-search__input"
        placeholder="Ülke, dizi veya oyuncu ara…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {showResults && hasResults && (
        <div className="panel-search__results">
          {countryResults.map((c) => (
            <button
              key={`country-${c.iso2}`}
              className="panel-search__result"
              onClick={() => {
                onSelectCountry?.(c.iso2)
                setQuery('')
              }}
            >
              <span className="panel-search__result-flag" aria-hidden="true">
                🌐
              </span>
              <span className="panel-search__result-info">
                <span className="panel-search__result-name">{c.name}</span>
                <span className="panel-search__result-meta">Ülke</span>
              </span>
            </button>
          ))}
          {actorResults.map((a) => (
            <button
              key={`actor-${a.id}`}
              className="panel-search__result"
              onClick={() => {
                onSelectActor?.(a.id)
                setQuery('')
              }}
            >
              {a.profilePath ? (
                <img className="panel-search__result-photo" src={`${PROFILE_BASE}${a.profilePath}`} alt="" />
              ) : (
                <span className="panel-search__result-photo panel-search__result-photo--empty" aria-hidden="true" />
              )}
              <span className="panel-search__result-info">
                <span className="panel-search__result-name">{a.name}</span>
                <span className="panel-search__result-meta">{Array.from(a.seriesNames).slice(0, 2).join(', ')}</span>
              </span>
            </button>
          ))}
          {seriesResults.map((s) => (
            <button
              key={`series-${s.id}`}
              className="panel-search__result"
              onClick={() => {
                onSelectSeriesGlobal?.(s.id)
                setQuery('')
              }}
            >
              {s.posterPath ? (
                <img className="panel-search__result-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
              ) : (
                <span className="panel-search__result-poster panel-search__result-poster--empty" aria-hidden="true" />
              )}
              <span className="panel-search__result-info">
                <span className="panel-search__result-name">{s.name}</span>
                <span className="panel-search__result-meta">Dizi</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {showResults && !hasResults && <p className="panel-search__empty">Sonuç bulunamadı.</p>}
    </div>
  )
}

// Skor, baskın tema, IMDb puanı ve anlık trend zaten haritadaki glassmorphism pop-up
// kartında (bkz. MapPopupCard.jsx / Globe3D.jsx buildPopupElement — App.jsx'teki aynı
// `selected`/`activeSeries` state'inden beslenir) gösteriliyor; burada tekrarlanmıyor. Bu
// panel sadece pop-up'ta YER ALMAYAN derinlemesine içeriği taşır: görünürlük geçmişi
// grafiği, bölgesel arama ilgisi kırılımı ve ülkedeki tüm dizilerin tam listesi. Bir dizi
// satırına tıklamak o diziyi haritadaki pop-up'ta ve IMDb kartında da aktif hale getirir
// (bkz. App.jsx activeSeriesId/onSelectSeries) — ayrıca bir oyuncuya tıklamak bu panelin
// aynı slotunu geçici olarak oyuncu görünümüne çevirir (bkz. activeActorId/ActorPanel).
export default function CountryPanel({
  country,
  allCountries,
  onClose,
  onSelectActor,
  onSelectSeries,
  onSelectSeriesGlobal,
  onSelectCountry,
  activeSeriesId,
  collapsed,
  onToggleCollapsed,
  activeActorId,
  onCloseActor,
  onShowActorNetwork,
  activeSeriesGlobalId,
  onCloseSeriesGlobal,
  onShowSeriesOnMap,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [periodRange, setPeriodRange] = useState('monthly')
  const [countryPeriods, setCountryPeriods] = useState(null)

  useEffect(() => {
    setExpandedId(null)
  }, [country?.iso2])

  // Proxy ülkelerin (dataSource: 'proxy') visibility_history'de hiç kaydı yok (bkz.
  // server/data-pipeline.js) — onlar için istek atmadan direkt boş döneriz.
  useEffect(() => {
    if (!country?.iso2 || country.dataSource === 'proxy') {
      setCountryPeriods(null)
      return
    }
    let cancelled = false
    fetchCountryPeriods(country.iso2, periodRange)
      .then((res) => {
        if (!cancelled) setCountryPeriods(res)
      })
      .catch((err) => {
        if (!cancelled) console.error('[CountryPanel] periods', err.message)
      })
    return () => {
      cancelled = true
    }
  }, [country?.iso2, periodRange])

  const handleSelectSeriesRow = (s, isExpanded, key) => {
    setExpandedId(isExpanded ? null : key)
    onSelectSeries?.(s.id)
  }

  return (
    <>
      {/* Panel katlanmış olsa da arama her zaman erişilebilir kalsın diye .panel-wrap'in
          DIŞINDA, haritanın üzerinde kendi sabit konumunda. */}
      <div className="panel-search-wrap">
        <PanelSearch
          allCountries={allCountries}
          onSelectActor={onSelectActor}
          onSelectSeriesGlobal={onSelectSeriesGlobal}
          onSelectCountry={onSelectCountry}
        />
      </div>
      <div className="panel-wrap">
        <button
          className="panel-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Ülke panelini aç' : 'Ülke panelini kapat'}
          title={collapsed ? 'Paneli aç' : 'Paneli kapat'}
        >
          {collapsed ? '‹' : '›'}
        </button>

        <div className={collapsed ? 'panel panel--collapsed' : 'panel'}>
          {activeActorId != null ? (
            <>
              <button className="panel__close" onClick={onClose} aria-label="Kapat">
                ×
              </button>
              <button className="panel__back-btn" onClick={onCloseActor}>
                ← Ülkeye dön
              </button>
              <ActorPanel
                personId={activeActorId}
                onShowNetwork={onShowActorNetwork}
                onSelectSeriesGlobal={onSelectSeriesGlobal}
              />
            </>
          ) : activeSeriesGlobalId != null ? (
            <>
              <button className="panel__close" onClick={onClose} aria-label="Kapat">
                ×
              </button>
              <button className="panel__back-btn" onClick={onCloseSeriesGlobal}>
                ← Geri
              </button>
              <SeriesPanel
                seriesId={activeSeriesGlobalId}
                allCountries={allCountries}
                onSelectActor={onSelectActor}
                onShowOnMap={onShowSeriesOnMap}
              />
            </>
          ) : !country ? (
            <p className="dashboard__empty">Detayları görmek için globdeki bir ülkeye tıklayın.</p>
          ) : (
            <>
              <button className="panel__close" onClick={onClose} aria-label="Kapat">
                ×
              </button>
              <h2>{country.name}</h2>
              {country.dataSource === 'proxy' ? (
                <span
                  className="panel__data-badge panel__data-badge--proxy"
                  title="TMDB/JustWatch'ta bu ülke için hiçbir yayın sağlayıcı verisi yok. Gösterilen değer, Google Trends üzerinden gerçek yayın/izlenme verisi DEĞİL, sadece arama ilgisine dayalı bir tahmindir."
                >
                  ⚡ Arama Hacmi Tahmini
                </span>
              ) : (
                <span className="panel__data-badge panel__data-badge--tmdb" title="Bu ülkenin verisi TMDB/JustWatch'ın gerçek yayın sağlayıcı kataloğundan geliyor.">
                  ✓ TMDB Resmi Veri
                </span>
              )}

              {country.dataSource === 'proxy' ? (
                <p className="panel__subtitle">
                  TMDB/JustWatch'ta yayın sağlayıcı verisi yok — arama hacmi endeksi: {country.searchInterestScore}/100
                </p>
              ) : (
                <p className="panel__subtitle">{country.seriesCount} dizi yayında</p>
              )}

              <h3>Trend ve Görünürlük Geçmişi</h3>
              {country.dataSource === 'proxy' ? (
                <p className="dashboard__empty">
                  Bu ülke için gerçek bir görünürlük geçmişi tutulmuyor (skor gerçek yayın
                  verisine değil, tek seferlik bir arama ilgisi tahminine dayanıyor).
                </p>
              ) : (
                <>
                  <Sparkline history={country.history} />
                  <PeriodChart
                    periods={countryPeriods?.periods || []}
                    valueKey="avgScore"
                    range={periodRange}
                    onRangeChange={setPeriodRange}
                    unitLabel="puan"
                  />
                </>
              )}

              {country.topSeries && (
                <>
                  <h3>Bölgesel İlgi Dağılımı</h3>
                  <RegionalInterest seriesName={country.topSeries.name} iso2={country.iso2} />
                </>
              )}

              {country.dataSource === 'proxy' ? (
                <>
                  <h3>Yayındaki diziler</h3>
                  <p className="dashboard__empty">
                    Bu ülke için TMDB/JustWatch'ta hiçbir dizi/yayın sağlayıcı eşleşmesi
                    bulunamadı. Yukarıdaki {country.searchInterestScore}/100 değeri, "
                    {country.proxyQueryTerm}" terimi için Google Trends arama ilgisi
                    endeksidir — gerçek yayın veya izlenme verisi değildir.
                  </p>
                </>
              ) : (
                <>
                  <h3>Yayındaki diziler</h3>
                  <ul className="panel__series-list">
                    {country.seriesList.map((s) => {
                  const key = s.id ?? s.name
                  const isExpanded = expandedId === key
                  const isActiveOnMap = activeSeriesId != null && s.id === activeSeriesId
                  return (
                    <li
                      key={key}
                      className={
                        isExpanded
                          ? 'panel__series-item panel__series-item--expanded'
                          : 'panel__series-item'
                      }
                      onClick={() => handleSelectSeriesRow(s, isExpanded, key)}
                    >
                      <div className="panel__series-row">
                        {s.posterPath ? (
                          <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
                        ) : (
                          <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
                        )}
                        <span className="panel__series-info">
                          <span className="panel__series-name">
                            {s.name}
                            {isActiveOnMap && (
                              <span className="panel__series-onmap" title="Haritada gösteriliyor">
                                🗺️
                              </span>
                            )}
                          </span>
                          <span className="panel__series-meta">
                            {yearOf(s.firstAirDate) || '—'} · {s.theme}
                          </span>
                        </span>
                        <span className="panel__series-score">{s.popularity.toFixed(1)}</span>
                      </div>
                      {isExpanded && (
                        <div className="panel__series-detail" onClick={(e) => e.stopPropagation()}>
                          <p className="panel__series-overview">{s.overview || 'Bu dizi için özet bulunmuyor.'}</p>
                          <CastBar cast={s.cast} onSelectActor={onSelectActor} />
                        </div>
                      )}
                    </li>
                  )
                })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
