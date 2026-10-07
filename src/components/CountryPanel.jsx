import { useEffect, useMemo, useState } from 'react'
import { watchLevelText } from '../lib/scale.js'
import ActorPanel from './ActorPanel.jsx'
import { CountryTv } from './TvSections.jsx'
import Avatar from './Avatar.jsx'
import Flag from './Flag.jsx'
import { IconReport } from './Icons.jsx'
import { fetchRegionalInterest, fetchCountryCharts, fetchCountryContext } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import PeriodChart from './PeriodChart.jsx'
import ChartList, { fmtDateTr } from './ChartList.jsx'
import { AVAILABILITY_NOTE } from '../lib/methodologyNotes.js'
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
                <Flag iso2={c.iso2} />
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
              <Avatar
                className="panel-search__result-photo"
                src={a.profilePath ? `${PROFILE_BASE}${a.profilePath}` : null}
                name={a.name}
              />
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

/**
 * "Şu an listede" + "Bu ülkede en çok izlenenler" — tüm platformların listeleri birlikte (platform adı
 * gösterilmez). Hiçbir platformda liste yoksa ansiklopedi okunma sıralamasına düşer.
 */
/** Liste ya da okunma verisi var mı (yoksa yayın kataloğu olmayan ülkede "en çok izlenenler" bölümü hiç basılmaz). */
function hasWatchData(charts) {
  const l = charts?.lists
  return Boolean(
    (l && (l.now.length > 0 || l.top.length > 0 || charts.netflix?.status === 'hesaplandi')) || charts?.wiki?.[0]
  )
}

const fmtInt = (n) => new Intl.NumberFormat('tr-TR').format(n)

/**
 * Yayın kataloğu olmayan ülkede boş bölümler yerine eldeki veri (2026-10-06): bağlı olduğu ülkenin bu haftaki
 * sıralaması, Türkiye'de okuyan öğrenci sayısı, basın taraması özeti.
 */
export function CountryContext({ iso2, allCountries, onSelectSeries, onSelectCountry, seriesInfo }) {
  const { status, data } = useAsync(() => fetchCountryContext(iso2), [iso2])
  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Yükleniyor…</p>
  if (status !== 'ready' || !data) return null
  const { parent, students, press } = data
  const parentName = parent ? countryNames[parent.iso2]?.name || parent.iso2 : null
  const parentCountry = parent ? allCountries?.find((c) => c.iso2 === parent.iso2) : null
  return (
    <>
      {parent && (
        <>
          <h3>Bağlı olduğu ülke</h3>
          <p className="panel__context-line">
            <Flag iso2={parent.iso2} />{' '}
            {parentCountry && onSelectCountry ? (
              <button type="button" className="dashboard__link-btn" onClick={() => onSelectCountry(parentCountry)}>
                {parentName}
              </button>
            ) : (
              parentName
            )}{' '}
            — yayın platformları çoğunlukla bu ülkenin kataloğunu sunar.
          </p>
          {parent.now.length > 0 && (
            <ChartList
              compact
              showPosters
              items={parent.now.map((it) => ({
                ...it,
                rank: it.position,
                kind: 'series',
                posterPath: it.posterPath ?? seriesInfo?.get(it.seriesId)?.posterPath ?? null,
              }))}
              onSelect={onSelectSeries}
            />
          )}
        </>
      )}
      <h3>Eldeki veriler</h3>
      <ul className="panel__context">
        <li>
          <strong>Türkiye'de okuyan öğrenci:</strong>{' '}
          {students
            ? `${fmtInt(students.students)} (${students.year})${students.changePct != null ? ` · ${students.baseYear}'e göre ${students.changePct > 0 ? '+' : ''}${students.changePct}%` : ''}`
            : 'kayıt yok'}
        </li>
        <li>
          <strong>Basın:</strong>{' '}
          {!press
            ? 'tarama sırada; henüz sonuç yok'
            : press.withNews > 0
              ? `${press.series} dizi tarandı, ${press.withNews} taramada haber bulundu (${press.news} haber)${press.tone ? ` · ton ${press.tone}` : ''}`
              : `${press.scanned} tarama yapıldı, henüz haber bulunamadı`}
        </li>
      </ul>
    </>
  )
}

export function WatchLists({ charts, onSelectSeries, seriesInfo }) {
  if (!charts) return null
  const nf = charts.netflix
  const lists = charts.lists
  if (lists && (lists.now.length > 0 || lists.top.length > 0 || nf?.status === 'hesaplandi')) {
    return (
      <>
        <h3>Şu an listede</h3>
        <div className="panel__now">
          <ChartList
            compact
            showPosters
            items={lists.now.map((it) => ({ ...it, meta: null }))}
            emptyText="Bu hafta listelerde Türk dizisi yok."
            onSelect={onSelectSeries}
          />
        </div>
        {charts.turkeyTv && !lists.now.some((it) => (it.platforms ?? [it.platform]).includes('TV')) && (
          <>
            <h3>Türkiye TV — {fmtDateTr(charts.turkeyTv.date)}</h3>
            <ChartList
              compact
              showPosters
              periodWord="gün"
              items={charts.turkeyTv.items}
              emptyText="Bu günün listesinde dizi yok."
              onSelect={onSelectSeries}
            />
          </>
        )}
        <h3>Bu ülkede en çok izlenenler</h3>
        <ChartList
          showPosters
          items={lists.top.map((t, i) => ({ ...t, rank: i + 1, meta: null }))}
          emptyText="Son 52 haftada listelere Türk dizisi girmedi."
          onSelect={onSelectSeries}
        />
        {yearAgoText(nf?.yearAgo) && <p className="panel__year-ago">{yearAgoText(nf.yearAgo)}</p>}
      </>
    )
  }
  const wiki = charts.wiki?.[0]
  return (
    <>
      <h3>Bu ülkede en çok izlenenler</h3>
      {wiki ? (
        <ChartList
          showPosters
          items={wiki.items.map((it, i) => ({
            rank: i + 1,
            seriesId: it.seriesId,
            name: it.name,
            kind: 'series',
            meta: `${Math.round(it.views / 1000)}k okunma`,
            posterPath: it.posterPath ?? seriesInfo?.get(it.seriesId)?.posterPath ?? null,
          }))}
          onSelect={onSelectSeries}
        />
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
  onSelectSeriesGlobal,
  onSelectCountry,
  collapsed,
  onToggleCollapsed,
  activeActorId,
  onCloseActor,
  onShowActorNetwork,
  onOpenReport,
}) {
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
  const seriesInfo = useMemo(() => {
    const m = new Map()
    for (const c of allCountries || [])
      for (const sr of c.seriesList || []) if (!m.has(sr.id)) m.set(sr.id, { name: sr.name, posterPath: sr.posterPath })
    return m
  }, [allCountries])

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
                  <IconReport size={14} inline />
                  Rapor
                </button>
              )}
              {/* "✓ Resmi Veri" rozeti daha önce kaldırılmıştı; proxy (tahmini) veri rozeti de
                  kullanıcı talebiyle kaldırıldı — veri kaynağı dökümü artık hiçbir yerde
                  gösterilmiyor. Alt başlık ("Arama hacmi endeksi: X/100") ayrı bir gerçek
                  bilgi olduğu için (rozet değil) olduğu gibi kalıyor. */}
              {country.limited ? (
                <p className="panel__subtitle">
                  Sınırlı veri: bu ülkede yayın kataloğu tutulmuyor.
                  {country.watchSignal?.provisional ? ` ${watchLevelText(country.watchSignal)}.` : ''}
                </p>
              ) : country.dataSource === 'proxy' ? (
                <p className="panel__subtitle">Arama hacmi endeksi: {country.searchInterestScore}/100</p>
              ) : (
                <p className="panel__subtitle">{country.seriesCount} dizi yayında</p>
              )}

              {(country.dataSource !== 'proxy' || hasWatchData(charts)) && (
                <WatchLists
                  charts={charts}
                  seriesInfo={seriesInfo}
                  onSelectSeries={(id) => onSelectSeriesGlobal?.(id)}
                />
              )}

              <CountryTv
                iso2={country.iso2}
                seriesInfo={seriesInfo}
                onSelectSeries={(id) => onSelectSeriesGlobal?.(id)}
              />

              {country.dataSource === 'proxy' && (
                <CountryContext
                  seriesInfo={seriesInfo}
                  iso2={country.iso2}
                  allCountries={allCountries}
                  onSelectSeries={(id) => onSelectSeriesGlobal?.(id)}
                  onSelectCountry={onSelectCountry}
                />
              )}

              {country.dataSource !== 'proxy' && <h3>Listeye giren diziler — zaman içinde</h3>}
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
                  <p className="dashboard__hint">Dönem başına listelere giren farklı Türk dizisi sayısı.</p>
                </>
              ) : country.dataSource === 'proxy' ? null : (
                <p className="dashboard__empty">Bu ülkede liste kaydı yok; zaman çizelgesi oluşmadı.</p>
              )}

              {country.topSeries && (
                <>
                  <h3>Bölgesel İlgi Dağılımı</h3>
                  <RegionalInterest seriesName={country.topSeries.name} iso2={country.iso2} />
                </>
              )}

              {country.dataSource === 'proxy' ? null : (
                <>
                  <h3 title={AVAILABILITY_NOTE}>
                    Yayındaki diziler — {country.seriesCount} dizi
                    {charts?.access?.platformCount ? `, ${charts.access.platformCount} platformda` : ''} ⓘ
                  </h3>
                  <ul className="panel__series-list">
                    {sortedSeriesList.map((s, i) => {
                      const open = () => onSelectSeriesGlobal?.(s.id)
                      return (
                        <li
                          key={s.id ?? s.name}
                          className="panel__series-item"
                          role="button"
                          tabIndex={0}
                          aria-label={`${s.name} — dizi sayfasını aç`}
                          onClick={open}
                          onKeyDown={onEnterOrSpace(open)}
                        >
                          <div className="panel__series-row">
                            <span className="panel__series-rank">{i + 1}.</span>
                            {s.posterPath ? (
                              <img className="panel__series-poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" />
                            ) : (
                              <span className="panel__series-poster panel__series-poster--empty" aria-hidden="true" />
                            )}
                            <span className="panel__series-info">
                              <span className="panel__series-name">{s.name}</span>
                              <span className="panel__series-meta">
                                {yearOf(s.firstAirDate) || '—'} · {s.theme}
                              </span>
                              {s.platforms?.length > 0 && (
                                <span className="panel__series-meta">{s.platforms.join(' · ')}</span>
                              )}
                            </span>
                          </div>
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
