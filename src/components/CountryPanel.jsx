import { useEffect, useMemo, useState } from 'react'
import CastBar from './CastBar.jsx'
import ActorPanel from './ActorPanel.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import { fetchRegionalInterest, fetchCountryPeriods, fetchSeriesPopularity } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PeriodChart from './PeriodChart.jsx'
import MediaSentimentCard, { HybridScoreTag } from './MediaSentimentCard.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'

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

  // value:0 olan bölgeler gerçekte "ölçülebilir ilgi yok" demek — listede göstermek sadece
  // gürültü (kullanıcı talebi: "yalnızca değer > 0 olanlar listelensin").
  const top = state.byRegion.filter((r) => r.value > 0).slice(0, 8)
  const maxValue = Math.max(...top.map((r) => r.value), 1)

  if (top.length === 0) {
    return <p className="dashboard__empty">Bu ülke/dizi için bölgesel arama ilgisi verisi bulunamadı.</p>
  }

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

// Haritada artık bir tıklama pop-up'ı YOK (kullanıcı talebi — özellikle mobilde harita
// görünümünü bozuyordu) — bir ülkeye/diziye dair TÜM detaylar (skor, tema, IMDb puanı,
// trend, görünürlük geçmişi, bölgesel arama ilgisi, dizilerin tam listesi) yalnızca bu
// panelde gösterilir. Bir dizi satırına tıklamak o diziyi IMDb kartında da aktif hale
// getirir (bkz. App.jsx activeSeriesId/onSelectSeries) — ayrıca bir oyuncuya tıklamak bu
// panelin aynı slotunu geçici olarak oyuncu görünümüne çevirir (bkz. activeActorId/ActorPanel).
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
  onGoToSeriesAnalysis,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [periodRange, setPeriodRange] = useState('monthly')
  const [countryPeriods, setCountryPeriods] = useState(null)
  const [seriesRange, setSeriesRange] = useState('current')
  const [seriesPopularity, setSeriesPopularity] = useState(null)

  // Tüm dizilerin (ülkeden bağımsız — TMDB popülerliği zaten global tek bir değer, bkz.
  // server/series-period-history.js) dönem bazlı ortalaması — 'current' seçiliyse hiç
  // istek atılmaz, dizinin O ANKİ canlı popülerliği (mevcut/eski davranış) kullanılır.
  useEffect(() => {
    if (seriesRange === 'current') {
      setSeriesPopularity(null)
      return
    }
    let cancelled = false
    fetchSeriesPopularity(seriesRange)
      .then((res) => {
        if (!cancelled) setSeriesPopularity(res.items)
      })
      .catch((err) => {
        if (!cancelled) console.error('[CountryPanel] series-popularity', err.message)
      })
    return () => {
      cancelled = true
    }
  }, [seriesRange])

  // 'current' seçiliyse mevcut davranış (canlı popülerliğe göre, aggregate.js'in zaten
  // sıraladığı sıra) korunur. Aksi halde seçili dönemdeki ortalama popülerliğe göre yeniden
  // sıralanır — o dönem için geçmişi olmayan (yeni) diziler dürüstçe canlı değerine düşer,
  // listeden atılmaz/0 sayılmaz.
  const sortedSeriesList = useMemo(() => {
    const list = country?.seriesList || []
    if (seriesRange === 'current' || !seriesPopularity) return list
    return [...list].sort((a, b) => {
      const aValue = seriesPopularity[a.id]?.value ?? a.popularity
      const bValue = seriesPopularity[b.id]?.value ?? b.popularity
      return bValue - aValue
    })
  }, [country?.seriesList, seriesRange, seriesPopularity])

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
              {/* "✓ Resmi Veri" rozeti daha önce kaldırılmıştı; proxy (tahmini) veri rozeti de
                  kullanıcı talebiyle kaldırıldı — veri kaynağı dökümü artık hiçbir yerde
                  gösterilmiyor. Alt başlık ("Arama hacmi endeksi: X/100") ayrı bir gerçek
                  bilgi olduğu için (rozet değil) olduğu gibi kalıyor. */}
              {country.dataSource === 'proxy' ? (
                <p className="panel__subtitle">Arama hacmi endeksi: {country.searchInterestScore}/100</p>
              ) : (
                <p className="panel__subtitle">{country.seriesCount} dizi yayında</p>
              )}

              <h3>Trend ve Görünürlük Geçmişi</h3>
              {country.dataSource === 'proxy' ? (
                <p className="dashboard__empty">Görünürlük geçmişi tutulmuyor.</p>
              ) : (
                // Eskiden burada hem Sparkline (son 7 gün) hem PeriodChart (Aylık/Yıllık)
                // yan yana gösteriliyordu — aynı veriyi iki farklı grafikle tekrarlamak kafa
                // karıştırıyordu (kullanıcı talebi: "mükerrer grafiği teke indir"). Sparkline
                // kaldırıldı; PeriodChart zaten Aylık/Yıllık geçişiyle daha kapsamlı ve tek
                // başına yeterli tek bir bileşik zaman serisi.
                <PeriodChart
                  periods={countryPeriods?.periods || []}
                  valueKey="avgScore"
                  range={periodRange}
                  onRangeChange={setPeriodRange}
                  unitLabel="puan"
                />
              )}

              {country.topSeries && (
                <>
                  <h3>Bölgesel İlgi Dağılımı</h3>
                  <RegionalInterest seriesName={country.topSeries.name} iso2={country.iso2} />
                </>
              )}

              {country.dataSource !== 'proxy' && (
                <>
                  <h3>Ülkede En Çok İlgi Gören İlk 5 Dizi</h3>
                  <CountryLeaderboard iso2={country.iso2} />
                </>
              )}

              {country.dataSource === 'proxy' ? (
                <>
                  <h3>Yayındaki diziler</h3>
                  <p className="dashboard__empty">Bu ülke için yayın verisi yok.</p>
                </>
              ) : (
                <>
                  <h3>Yayındaki diziler</h3>
                  <div className="period-toggle" role="group" aria-label="Popülerlik dönemi">
                    {[
                      ['current', 'Şu An'],
                      ['monthly', 'Aylık'],
                      ['yearly', 'Yıllık'],
                      ['5yearly', '5 Yıllık'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={
                          seriesRange === value ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'
                        }
                        onClick={() => setSeriesRange(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {seriesRange !== 'current' && seriesPopularity && Object.values(seriesPopularity).some((v) => v.isPartial) && (
                    <p className="dashboard__hint">Bazı diziler için veri henüz kısmi.</p>
                  )}
                  <ul className="panel__series-list">
                    {sortedSeriesList.map((s, i) => {
                  const key = s.id ?? s.name
                  const isExpanded = expandedId === key
                  const isActiveOnMap = activeSeriesId != null && s.id === activeSeriesId
                  // Ham TMDB popülerlik puanı kullanıcılar tarafından yüzde sanılıp kafa
                  // karıştırıyordu (kullanıcı geri bildirimi) — satırda artık sadece net bir
                  // 1..N sırası var, ham sayı + teknik etiketler (kısmi veri *, TR reyting
                  // rozeti) sadece tıklanınca açılan ayrıntıda gösteriliyor.
                  const rawScore =
                    seriesRange !== 'current' && seriesPopularity?.[s.id]?.value != null
                      ? seriesPopularity[s.id].value
                      : s.popularity
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
                        <span className="panel__series-rank">{i + 1}.</span>
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
                      </div>
                      {isExpanded && (
                        <div className="panel__series-detail" onClick={(e) => e.stopPropagation()}>
                          <p className="panel__series-overview">{s.overview || 'Bu dizi için özet bulunmuyor.'}</p>
                          <p className="panel__series-raw-score">
                            Ham popülerlik puanı: <strong>{rawScore.toFixed(1)}</strong>
                            {seriesRange !== 'current' && seriesPopularity?.[s.id]?.isPartial && (
                              <span title="Bu dönem için veri henüz kısmi"> *</span>
                            )}
                            {seriesRange !== 'current' && seriesPopularity?.[s.id]?.source === 'reytingtv_rank' && (
                              <span
                                className="panel__series-source-tag"
                                title="Türkiye'deki gerçek günlük reyting sırasına dayanıyor (canlı popülerlik verisi değil)"
                              >
                                TR
                              </span>
                            )}
                          </p>
                          <CastBar cast={s.cast} onSelectActor={onSelectActor} />
                          <HybridScoreTag seriesName={s.name} iso2={country.iso2} />
                          {onGoToSeriesAnalysis && (
                            <button
                              className="dashboard__link-btn"
                              style={{ marginTop: '0.5rem' }}
                              onClick={() => onGoToSeriesAnalysis(s.name)}
                            >
                              📊 Dizi Analizine Git
                            </button>
                          )}
                          <h4 className="panel__series-detail-heading">Basın &amp; Medya Algısı</h4>
                          <MediaSentimentCard seriesId={s.id} iso2={country.iso2} seriesName={s.name} />
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
