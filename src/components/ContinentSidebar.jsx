import { useEffect, useMemo, useState } from 'react'
import { CONTINENTS, groupByContinent, resolveIso2FromLabel } from '../lib/continents.js'
import { fetchTurkishLearningIndex, fetchDuolingoStats, fetchTourismSummary, fetchContinentCharts } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import countryNames from '../data/country-centroids.json'
import { WATCH_LEVELS, WATCH_LEVEL_COLORS } from '../lib/scale.js'
import { EMPTY } from '../lib/emptyStates.js'
import { ChartSource, fmtDateTr } from './ChartList.jsx'
import { IconTv, IconTrophy, IconLuggage, IconGlobe } from './Icons.jsx'

// Kıtasal analiz — düzen aynı; içerik izlenmeye göre: lider = en yüksek izlenme düzeyi, en çok izlenen dizi =
// kıtada son 52 haftada en çok ülke-hafta toplayan Netflix Top 10 dizisi. Skor/ortalama yok.

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

const MONTH_NAMES_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]

function ExportTourismStats({ tourismItems, continentCountries }) {
  const iso2Set = new Set((continentCountries || []).map((c) => c.iso2))
  const matched = (tourismItems || [])
    .filter((item) => iso2Set.has(item.iso2))
    .sort((a, b) => b.visitorCount - a.visitorCount)

  return (
    <div className="sidebar__stat">
      <div className="sidebar__stat-label" title="YİGM Sınır İstatistikleri Bülteni'nden otomatik.">
        <IconLuggage size={13} inline />
        Turizm Rakamları ⓘ
      </div>
      {matched.length === 0 ? (
        <p className="sidebar__stat-note">{EMPTY.continentNoTourism}</p>
      ) : (
        <ol className="sidebar__top-list">
          {matched.slice(0, 3).map((item) => (
            <li key={item.iso2}>
              <span className="sidebar__top-country-name">{nameOf(item.iso2)}</span>
              <span className="sidebar__top-country-meta">
                {item.visitorCount.toLocaleString('tr-TR')} turist ({MONTH_NAMES_TR[item.month - 1]} {item.afterYear})
                {item.changePct != null &&
                  ` · ${item.changePct > 0 ? '+' : ''}${item.changePct}% (${item.beforeYear}→${item.afterYear})`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function findTopLearningCountry(byCountry, continentCountries) {
  const iso2Set = new Set((continentCountries || []).map((c) => c.iso2))
  return byCountry
    .map((entry) => ({ ...entry, iso2: resolveIso2FromLabel(entry.country) }))
    .filter((entry) => entry.iso2 && iso2Set.has(entry.iso2))
    .sort((a, b) => b.value - a.value)[0]
}

function LevelBar({ levels, total }) {
  const n = WATCH_LEVELS.reduce((s, l) => s + (levels?.[l] || 0), 0)
  if (!n) return <p className="sidebar__stat-note">Bu kıtada izlenme düzeyi hesaplanan ülke yok.</p>
  return (
    <div className="sidebar__levels" role="list" aria-label="İzlenme düzeyi dağılımı">
      {[...WATCH_LEVELS].reverse().map((l) => {
        const c = levels?.[l] || 0
        if (!c) return null
        return (
          <div key={l} className="sidebar__level-row" role="listitem">
            <span className="legend__swatch" style={{ background: WATCH_LEVEL_COLORS[l] }} />
            <span className="sidebar__level-label">{l}</span>
            <span className="sidebar__level-count">{c} ülke</span>
          </div>
        )
      })}
      {total > n && <p className="sidebar__stat-note">{total - n} ülkede sinyal yetersiz.</p>}
    </div>
  )
}

export default function ContinentSidebar({
  countries,
  onSelectCountry,
  onSelectSeries,
  onFocusContinent,
  collapsed,
  onToggleCollapsed,
}) {
  const continentStats = useMemo(() => groupByContinent(countries || []), [countries])
  const firstWithData = continentStats.find((c) => c.countryCount > 0)
  const [selectedId, setSelectedId] = useState(firstWithData?.id || CONTINENTS[0].id)
  const [learningIndex, setLearningIndex] = useState(null)
  const [learningStatus, setLearningStatus] = useState('loading')
  const [duolingo, setDuolingo] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const [tourismItems, setTourismItems] = useState([])
  const chartsReq = useAsync(fetchContinentCharts, [])

  useEffect(() => {
    fetchTurkishLearningIndex()
      .then((res) => {
        setLearningIndex(res)
        setLearningStatus('ready')
      })
      .catch(() => setLearningStatus('unavailable'))
  }, [])

  useEffect(() => {
    fetchTourismSummary()
      .then((res) => setTourismItems(res.items || []))
      .catch((err) => {
        console.error('[ContinentSidebar] tourism-summary', err.message)
        setTourismItems([])
      })
  }, [])

  useEffect(() => {
    fetchDuolingoStats()
      .then(setDuolingo)
      .catch(() => setDuolingo(null))
  }, [])

  const selected = continentStats.find((c) => c.id === selectedId) || continentStats[0]
  const chart = chartsReq.data?.continents?.find((c) => c.id === selectedId) || null
  const topLearningCountry = useMemo(
    () =>
      learningStatus === 'ready' && learningIndex?.byCountry?.length > 0 && selected
        ? findTopLearningCountry(learningIndex.byCountry, selected.countries)
        : null,
    [learningIndex, learningStatus, selected]
  )
  const globalMomentum =
    duolingo?.status === 'ready' && duolingo.trend?.direction !== 'yetersiz-veri' ? duolingo.trend : null

  const handleSelectContinent = (id) => {
    setSelectedId(id)
    const stats = continentStats.find((c) => c.id === id)
    if (stats?.countryCount > 0) onFocusContinent?.(stats)
  }

  return (
    <div className="sidebar-wrap">
      <aside className={collapsed ? 'sidebar sidebar--collapsed' : 'sidebar'}>
        <div className="sidebar__header">
          <h3>Kıtasal Analiz</h3>
        </div>

        <nav className="sidebar__continent-list">
          {continentStats.map((c) => (
            <button
              key={c.id}
              className={
                c.id === selectedId ? 'sidebar__continent-btn sidebar__continent-btn--active' : 'sidebar__continent-btn'
              }
              onClick={() => handleSelectContinent(c.id)}
              disabled={c.countryCount === 0}
            >
              <span>{c.name}</span>
              <span className="sidebar__continent-count">{c.countryCount}</span>
            </button>
          ))}
        </nav>

        {selected && selected.countryCount > 0 ? (
          <div className="sidebar__body">
            {/* Kıta Lideri — izlenme düzeyi */}
            <button
              className="sidebar__big-card"
              onClick={() => chart?.leader && onSelectCountry?.(chart.leader.iso2)}
              title="Haritada göster"
              disabled={!chart?.leader}
            >
              <div className="sidebar__big-card-label">
                <IconTrophy size={13} inline />
                Kıta Lideri
              </div>
              {chartsReq.status === 'loading' ? (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Yükleniyor…</div>
              ) : chart?.leader ? (
                <>
                  <div className="sidebar__big-card-value">{nameOf(chart.leader.iso2)}</div>
                  <div className="sidebar__big-card-meta">
                    İzlenme düzeyi: {chart.leader.level} · yüzdelik konum {chart.leader.index}/100
                  </div>
                </>
              ) : (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Sinyal yetersiz</div>
              )}
            </button>

            {/* En Çok İzlenen Dizi — Netflix Top 10, son 52 hafta */}
            <div className="sidebar__big-card">
              <div className="sidebar__big-card-label">
                <IconTv size={13} inline />
                En Çok İzlenen Dizi
              </div>
              {chartsReq.status === 'loading' && (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Yükleniyor…</div>
              )}
              {chartsReq.status !== 'loading' && chart?.topSeries ? (
                <>
                  <button
                    type="button"
                    className="sidebar__big-card-value sidebar__big-card-value--link"
                    onClick={() => onSelectSeries?.(chart.topSeries.seriesId)}
                  >
                    {chart.topSeries.name}
                  </button>
                  <div className="sidebar__big-card-meta">
                    Sıralamada {chart.topSeries.countryWeeks} ülke-hafta (son 52 hafta) · en iyi #
                    {chart.topSeries.bestRank}
                    {chart.thisWeekSeriesCount ? ` · bu hafta listede ${chart.thisWeekSeriesCount} Türk dizisi` : ''}
                  </div>
                </>
              ) : chartsReq.status !== 'loading' ? (
                <div
                  className="sidebar__big-card-value sidebar__big-card-value--muted"
                  title={EMPTY.continentNoNetflix}
                >
                  Sıralama verisi yok
                </div>
              ) : null}
            </div>

            {/* Türkçe Dil Öğrenim İlgisi */}
            <div className="sidebar__big-card">
              <div className="sidebar__big-card-label">🇹🇷 Türkçe Dil Öğrenim İlgisi</div>
              {learningStatus === 'loading' && (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Yükleniyor…</div>
              )}
              {learningStatus !== 'loading' && !topLearningCountry && (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Veri birikiyor</div>
              )}
              {topLearningCountry && (
                <div className="sidebar__big-card-value">
                  {nameOf(topLearningCountry.iso2)} — {topLearningCountry.value}
                </div>
              )}
              {globalMomentum && (
                <div className="sidebar__big-card-meta">
                  <IconGlobe size={13} inline />
                  Küresel Dil Öğrenim İvmesi: {globalMomentum.changePct > 0 ? '+' : ''}
                  {globalMomentum.changePct}% (son {globalMomentum.windowDays} gün)
                </div>
              )}
            </div>

            <button className="sidebar__details-toggle" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? '▾ Detaylı istatistikleri gizle' : '▸ Detaylı istatistikleri göster'}
            </button>

            {showDetails && (
              <div className="sidebar__details">
                <div className="sidebar__stat">
                  <div className="sidebar__stat-label">En Çok İzlenen İlk 5 Ülke</div>
                  {chart?.topCountries?.length ? (
                    <ol className="sidebar__top-list">
                      {chart.topCountries.map((country) => (
                        <li key={country.iso2}>
                          <button
                            className="sidebar__top-country"
                            onClick={() => onSelectCountry?.(country.iso2)}
                            title="Haritada göster"
                          >
                            <span className="sidebar__top-country-name">{nameOf(country.iso2)}</span>
                            <span className="sidebar__top-country-meta">
                              {country.level}
                              {country.weeks ? ` · sıralamada ${country.weeks} dizi-hafta` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="sidebar__stat-note">Bu kıtada izlenme düzeyi hesaplanan ülke yok.</p>
                  )}
                </div>

                <div className="sidebar__stat">
                  <div className="sidebar__stat-label">İzlenme Düzeyi Dağılımı</div>
                  <LevelBar levels={chart?.levels} total={chart?.countryCount ?? selected.countryCount} />
                </div>

                {chart?.topSeriesList?.length > 1 && (
                  <div className="sidebar__stat">
                    <div className="sidebar__stat-label">Kıtada En Çok İzlenen 3 Dizi (son 52 hafta)</div>
                    <ol className="sidebar__top-list">
                      {chart.topSeriesList.map((s) => (
                        <li key={s.seriesId ?? s.name}>
                          <span className="sidebar__top-country-name">{s.name}</span>
                          <span className="sidebar__top-country-meta">
                            {s.periods} ülke-hafta · en iyi #{s.bestRank} · son {fmtDateTr(s.lastDate)}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <ChartSource
                      source={{ label: 'birleşik sıralama' }}
                      periodLabel={`son hafta ${fmtDateTr(chart.latestWeek)}`}
                    />
                  </div>
                )}

                <ExportTourismStats tourismItems={tourismItems} continentCountries={selected.countries} />
              </div>
            )}
          </div>
        ) : (
          <p className="dashboard__empty">{EMPTY.continentNoVisibility}</p>
        )}
      </aside>

      <button
        className="sidebar-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Kıtasal analiz panelini aç' : 'Kıtasal analiz panelini kapat'}
        title={collapsed ? 'Paneli aç' : 'Paneli kapat'}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
}
