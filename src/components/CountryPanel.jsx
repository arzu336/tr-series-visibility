import { useEffect, useMemo, useState } from 'react'
import CastBar from './CastBar.jsx'
import ActorPanel from './ActorPanel.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import { fetchRegionalInterest, fetchCountryPeriods, fetchSeriesPopularity } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PeriodChart from './PeriodChart.jsx'
import MediaSentimentCard, { HybridScoreTag } from './MediaSentimentCard.jsx'
import CountryLeaderboard from './CountryLeaderboard.jsx'
import { describePerCapita, formatTotalScore } from '../lib/perCapitaLabel.js'
import { useAsync } from '../lib/useAsync.js'
import { PER_CAPITA_SCORE_NOTE, TOTAL_SCORE_NOTE } from '../lib/methodologyNotes.js'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w92'
const PROFILE_BASE = 'https://image.tmdb.org/t/p/w92'
const MIN_QUERY_LENGTH = 2
const MAX_RESULTS_PER_GROUP = 6

function yearOf(dateStr) {
  return dateStr ? dateStr.slice(0, 4) : null
}

function RegionalInterest({ seriesName, iso2 }) {
  const { status, data } = useAsync(() => fetchRegionalInterest(seriesName, iso2), [seriesName, iso2], {
    enabled: Boolean(seriesName && iso2),
  })
  const byRegion = data?.byRegion || []

  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Yükleniyor…</p>
  if (status === 'error' || byRegion.length === 0) {
    return <p className="dashboard__empty">Bu ülke/dizi için bölgesel arama ilgisi verisi bulunamadı.</p>
  }

  const top = byRegion.filter((r) => r.value > 0).slice(0, 8)
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

  const trimmed = query.trim().toLocaleLowerCase('tr')
  const showResults = trimmed.length >= MIN_QUERY_LENGTH
  const countryResults = showResults
    ? countryIndex
        .filter((c) => c.name.toLocaleLowerCase('tr').includes(trimmed))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []
  const actorResults = showResults
    ? Array.from(actorIndex.values())
        .filter((a) => a.name.toLocaleLowerCase('tr').includes(trimmed))
        .slice(0, MAX_RESULTS_PER_GROUP)
    : []
  const seriesResults = showResults
    ? Array.from(seriesIndex.values())
        .filter((s) => s.name.toLocaleLowerCase('tr').includes(trimmed))
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

function CountryScoreCard({ country }) {
  const perCapita = describePerCapita(country)
  return (
    <div className="panel__score-card" role="group" aria-label="Görünürlük skorları">
      <div className="panel__score-item" title={TOTAL_SCORE_NOTE}>
        <span className="panel__score-label">Toplam görünürlük skoru ⓘ</span>
        <strong className="panel__score-value">{formatTotalScore(country.score)}</strong>
        <span className="panel__score-meta">{country.seriesCount} dizinin küresel popülerlik toplamı</span>
      </div>
      <div
        className={
          perCapita.status === 'unreliable'
            ? 'panel__score-item panel__score-item--unreliable'
            : 'panel__score-item'
        }
        title={PER_CAPITA_SCORE_NOTE}
      >
        <span className="panel__score-label">Kişi başına erişilebilirlik skoru ⓘ</span>
        {perCapita.status === 'unavailable' ? (
          <>
            <strong className="panel__score-value panel__score-value--empty">—</strong>
            <span className="panel__score-meta">{perCapita.note}</span>
          </>
        ) : (
          <>
            <strong className="panel__score-value">
              {perCapita.valueText}
              {perCapita.status === 'unreliable' && (
                <span className="panel__score-flag" title={perCapita.note}>
                  {' '}
                  ⚠
                </span>
              )}
            </strong>
            <span className="panel__score-meta">{perCapita.denominatorText}</span>
            {perCapita.status === 'unreliable' && <span className="panel__score-warning">{perCapita.note}</span>}
          </>
        )}
      </div>
    </div>
  )
}

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
  const [seriesRange, setSeriesRange] = useState('current')

  const popularityReq = useAsync(() => fetchSeriesPopularity(seriesRange), [seriesRange], {
    enabled: seriesRange !== 'current',
  })
  const seriesPopularity = popularityReq.data?.items ?? null

  const periodsReq = useAsync(() => fetchCountryPeriods(country.iso2, periodRange), [country?.iso2, periodRange], {
    enabled: Boolean(country?.iso2) && country?.dataSource !== 'proxy',
  })
  const countryPeriods = periodsReq.data

  useEffect(() => {
    if (popularityReq.error) console.error('[CountryPanel] series-popularity', popularityReq.error)
    if (periodsReq.error) console.error('[CountryPanel] periods', periodsReq.error)
  }, [popularityReq.error, periodsReq.error])

  const sortedSeriesList = useMemo(() => {
    const list = country?.seriesList || []
    if (seriesRange === 'current' || !seriesPopularity) return list
    const canliDegerler = list.map((s) => s.popularity).sort((a, b) => a - b)
    const canliYuzdelik = (deger) => {
      if (canliDegerler.length === 0) return 50
      const altinda = canliDegerler.filter((x) => x < deger).length
      const esit = canliDegerler.filter((x) => x === deger).length
      return ((altinda + esit / 2) / canliDegerler.length) * 100
    }
    const skor = (s) => seriesPopularity[s.id]?.percentile ?? canliYuzdelik(s.popularity)
    return [...list].sort((a, b) => skor(b) - skor(a))
  }, [country?.seriesList, seriesRange, seriesPopularity])

  useEffect(() => {
    setExpandedId(null)
  }, [country?.iso2])

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

              {/* Harita varsayılan olarak kişi başına metriği boyuyor (bkz. lib/scale.js) ama
                  panel şimdiye kadar yalnızca ham toplamı ima ediyordu — kullanıcı haritada gördüğü
                  rengi burada bir sayıyla eşleyemiyordu. İki skor yan yana, paydası açıkça yazılı:
                  ham toplam katalog büyüklüğünü, kişi başına değer pazar yoğunluğunu okutur. Proxy
                  ülkelerde görünürlük skoru hiç yok (Trends tahmini var), kart gösterilmez. */}
              {country.dataSource !== 'proxy' && <CountryScoreCard country={country} />}

              <h3>Trend ve Görünürlük Geçmişi</h3>
              {country.dataSource === 'proxy' ? (
                <p className="dashboard__empty">Görünürlük geçmişi tutulmuyor.</p>
              ) : (
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
