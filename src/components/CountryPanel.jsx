import { useEffect, useMemo, useState } from 'react'
import CastBar from './CastBar.jsx'
import ActorPanel from './ActorPanel.jsx'
import SeriesPanel from './SeriesPanel.jsx'
import { fetchRegionalInterest, fetchCountryCharts } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PeriodChart from './PeriodChart.jsx'
import MediaSentimentCard, { HybridScoreTag } from './MediaSentimentCard.jsx'
import ChartList, { ChartSource, fmtDateTr } from './ChartList.jsx'
import { WATCH_LEVEL_COLORS, NO_SIGNAL_COLOR } from '../lib/scale.js'
import { WATCH_LEVEL_NOTE, AVAILABILITY_NOTE } from '../lib/methodologyNotes.js'
import { useAsync } from '../lib/useAsync.js'
import { onEnterOrSpace } from '../lib/useDialog.js'
import { EMPTY } from '../lib/emptyStates.js'

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
    return <p className="dashboard__empty">{EMPTY.regionalInterestMissing}</p>
  }

  const top = byRegion.filter((r) => r.value > 0).slice(0, 8)
  const maxValue = Math.max(...top.map((r) => r.value), 1)

  if (top.length === 0) {
    return <p className="dashboard__empty">{EMPTY.regionalInterestMissing}</p>
  }

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {top.map((r) => (
          <div key={r.region} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{r.region}</div>
            <div className="benchmark-card__row-bar-track">
              <div
                className="benchmark-card__row-bar"
                style={{ width: `${(r.value / maxValue) * 100}%`, background: '#3987e5' }}
              />
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
            actors.set(actor.id, {
              id: actor.id,
              name: actor.name,
              profilePath: actor.profilePath,
              seriesNames: new Set(),
            })
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
    ? countryIndex.filter((c) => c.name.toLocaleLowerCase('tr').includes(trimmed)).slice(0, MAX_RESULTS_PER_GROUP)
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
        aria-label="Ülke, dizi veya oyuncu ara"
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

function yearAgoText(ya) {
  if (!ya) return null
  const liste = ya.entries?.length
    ? ya.entries.map((e) => `#${e.rank} ${e.name}`).join(', ')
    : 'listede Türk dizisi yoktu'
  if (ya.mode === 'exact') return `1 yıl önce (${fmtDateTr(ya.periodDate)}): ${liste}`
  if (ya.mode === 'window') return `1 yıl önce (±4 hafta, en yakın liste ${fmtDateTr(ya.periodDate)}): ${liste}`
  return `1 yıl önce liste yoktu; en yakın kayıt ${fmtDateTr(ya.periodDate)}: ${liste}`
}

const SOURCE_LABEL = {
  netflix_tudum: 'Netflix Top 10',
  wikipedia: 'Wikipedia',
  google_trends: 'Google Trends (önbellek)',
  tmdb_providers: 'TMDB/JustWatch',
}

/** Ülke paneli üst kartı: kaynak sırasındaki ilk dolu gerçek öne, diğerleri altında; izlenme düzeyi ve uyarılar. */
export function WatchFactsCard({ charts, status }) {
  if (status === 'loading' || status === 'idle')
    return <p className="dashboard__empty">İzlenme gerçekleri yükleniyor…</p>
  if (status === 'error' || !charts) return <p className="dashboard__empty">İzlenme gerçekleri alınamadı.</p>
  const level = charts.watch?.level ?? null
  // JSON'dan gelir: kimlik karşılaştırması olmaz, kaynak+tür ile ayır
  const sameFact = (a, b) => a && b && a.source === b.source && a.kind === b.kind
  const others = charts.facts.filter((f) => !sameFact(f, charts.primary))
  return (
    <div className="panel__watch-card" role="group" aria-label="İzlenme gerçekleri">
      <div className="panel__watch-level" title={WATCH_LEVEL_NOTE}>
        <span className="legend__swatch" style={{ background: level ? WATCH_LEVEL_COLORS[level] : NO_SIGNAL_COLOR }} />
        İzlenme düzeyi: <strong>{level ?? 'sinyal yetersiz'}</strong>
        {charts.watch?.index != null
          ? ` · yüzdelik konum ${charts.watch.index}/100 · güven ${charts.watch.confidence}`
          : ''}{' '}
        ⓘ
      </div>
      {charts.primary ? (
        <p className="panel__watch-primary">
          {charts.primary.text}
          <span className="panel__watch-source">{SOURCE_LABEL[charts.primary.source] || charts.primary.source}</span>
        </p>
      ) : (
        <p className="panel__watch-primary">{EMPTY.countryNoCharts}</p>
      )}
      {others.map((f) => (
        <p key={f.source + f.kind} className="panel__watch-fact">
          {f.text}
          <span className="panel__watch-source">{SOURCE_LABEL[f.source] || f.source}</span>
        </p>
      ))}
      {(charts.watch?.warnings || [])
        .filter((w) => w.code !== 'regional-wiki')
        .map((w) => (
          <p key={w.code} className="panel__watch-warning" role="note">
            ⚠ {w.text}
          </p>
        ))}
    </div>
  )
}

/** "Şu an listede" + "Bu ülkede en çok izlenenler" + "1 yıl önce" — Netflix; Netflix yoksa Wikipedia listesi. */
export function WatchLists({ charts, onSelectSeries }) {
  if (!charts) return null
  const nf = charts.netflix
  if (nf?.status === 'hesaplandi') {
    return (
      <>
        <h3>Şu an listede</h3>
        <div className="panel__now">
          <ChartList
            compact
            items={nf.now}
            emptyText={`Netflix Top 10 (${fmtDateTr(charts.latestWeek)}): bu hafta Türk dizisi yok.`}
            onSelect={onSelectSeries}
          />
        </div>
        <h3>Bu ülkede en çok izlenenler</h3>
        <ChartList
          items={nf.top.map((t, i) => ({ ...t, rank: i + 1 }))}
          emptyText={`Son 52 haftada Netflix Top 10'a Türk dizisi girmedi${nf.lastEntry ? `; son giriş ${fmtDateTr(nf.lastEntry)}` : ''}.`}
          onSelect={onSelectSeries}
        />
        {yearAgoText(nf.yearAgo) && <p className="panel__year-ago">{yearAgoText(nf.yearAgo)}</p>}
        <ChartSource
          source={nf.source}
          periodLabel={`son 52 hafta (${fmtDateTr(nf.window.from)} → ${fmtDateTr(nf.window.to)})`}
        />
      </>
    )
  }
  const wiki = charts.wiki?.[0]
  return (
    <>
      <h3>Bu ülkede en çok izlenenler</h3>
      {nf?.status === 'hesaplanamaz' && <p className="dashboard__hint">{nf.reason}</p>}
      {wiki ? (
        <>
          <ChartList
            items={wiki.items.map((it, i) => ({
              rank: i + 1,
              seriesId: it.seriesId,
              name: it.name,
              kind: 'series',
              meta: `${Math.round(it.views / 1000)}k okunma`,
            }))}
            onSelect={onSelectSeries}
          />
          <ChartSource
            source={{
              label: 'Wikipedia okunması',
              platform: `${wiki.lang} Vikipedi${wiki.regional ? ' (ortak dil; okunma ülkeye ayrılamaz)' : ''}`,
            }}
            periodLabel="son 12 ay"
          />
        </>
      ) : (
        <p className="dashboard__empty">{EMPTY.countryNoCharts}</p>
      )}
    </>
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
  onOpenReport,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const [periodRange, setPeriodRange] = useState('monthly')

  const chartsReq = useAsync(
    () => fetchCountryCharts(country.iso2, { range: periodRange }),
    [country?.iso2, periodRange],
    { enabled: Boolean(country?.iso2), keepPrevious: true }
  )
  const charts = chartsReq.data

  useEffect(() => {
    if (chartsReq.error) console.error('[CountryPanel] charts', chartsReq.error)
  }, [chartsReq.error])

  const sortedSeriesList = useMemo(() => country?.seriesList || [], [country?.seriesList])

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
              {onOpenReport && (
                <button
                  type="button"
                  className="panel__report-btn"
                  onClick={() => onOpenReport(country.iso2)}
                  aria-label={`${country.name} için ülke raporunu aç`}
                >
                  📄 Rapor
                </button>
              )}
              {/* "✓ Resmi Veri" rozeti daha önce kaldırılmıştı; proxy (tahmini) veri rozeti de
                  kullanıcı talebiyle kaldırıldı — veri kaynağı dökümü artık hiçbir yerde
                  gösterilmiyor. Alt başlık ("Arama hacmi endeksi: X/100") ayrı bir gerçek
                  bilgi olduğu için (rozet değil) olduğu gibi kalıyor. */}
              {country.dataSource === 'proxy' ? (
                <p className="panel__subtitle">Arama hacmi endeksi: {country.searchInterestScore}/100</p>
              ) : (
                <p className="panel__subtitle">{country.seriesCount} dizi yayında</p>
              )}

              <WatchFactsCard charts={charts} status={chartsReq.status} />

              <WatchLists charts={charts} onSelectSeries={(id) => onSelectSeriesGlobal?.(id)} />

              <h3>Listeye giren diziler — zaman içinde</h3>
              {charts?.timeline?.length ? (
                <>
                  <PeriodChart
                    periods={charts.timeline.map((t) => ({
                      period: t.period,
                      avgScore: t.seriesCount,
                      isCurrent: false,
                    }))}
                    valueKey="avgScore"
                    range={periodRange}
                    onRangeChange={setPeriodRange}
                    unitLabel="dizi"
                  />
                  <p className="dashboard__hint">Dönem başına Netflix Top 10'a giren farklı Türk dizisi sayısı.</p>
                </>
              ) : (
                <p className="dashboard__empty">
                  {country.dataSource === 'proxy'
                    ? EMPTY.visibilityHistoryProxy
                    : 'Bu ülkede Netflix Top 10 kaydı yok; zaman çizelgesi oluşmadı.'}
                </p>
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
                  <p className="dashboard__empty">Bu ülke için yayın verisi yok.</p>
                </>
              ) : (
                <>
                  <h3 title={AVAILABILITY_NOTE}>
                    Yayındaki diziler — {country.seriesCount} dizi
                    {charts?.access?.platformCount ? `, ${charts.access.platformCount} platformda` : ''} ⓘ
                  </h3>
                  {charts?.access?.platforms?.length > 0 && (
                    <p className="dashboard__hint">
                      {charts.access.platforms
                        .slice(0, 6)
                        .map((p) => `${p.name} (${p.count})`)
                        .join(' · ')}
                    </p>
                  )}
                  <ul className="panel__series-list">
                    {sortedSeriesList.map((s, i) => {
                      const key = s.id ?? s.name
                      const isExpanded = expandedId === key
                      const isActiveOnMap = activeSeriesId != null && s.id === activeSeriesId
                      return (
                        <li
                          key={key}
                          className={
                            isExpanded ? 'panel__series-item panel__series-item--expanded' : 'panel__series-item'
                          }
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          aria-label={`${s.name} — ${isExpanded ? 'ayrıntıyı kapat' : 'ayrıntıyı aç ve haritada göster'}`}
                          onClick={() => handleSelectSeriesRow(s, isExpanded, key)}
                          onKeyDown={onEnterOrSpace(() => handleSelectSeriesRow(s, isExpanded, key))}
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
                              <MediaSentimentCard seriesId={s.id} iso2={country.iso2} />
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
