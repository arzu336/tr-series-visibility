import { useState } from 'react'
import { fetchGlobalTop, fetchTurkeyTv } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import ChartList, { ChartSource, fmtDateTr } from './ChartList.jsx'
import { EMPTY } from '../lib/emptyStates.js'

// Genel görünüm şeridi (harita üstünde, katlanabilir): "Zirvedekiler — bu hafta" (en çok ülkede Netflix
// Top 10'da olan Türk dizileri) + Türkiye TV günlük listesi; tarih seçici ve "1 yıl önce".

function yearAgoLabel(ya, periodWord) {
  if (!ya) return null
  if (ya.mode === 'exact') return `1 yıl önce (${fmtDateTr(ya.periodDate ?? ya.week)})`
  if (ya.mode === 'window')
    return `1 yıl önce — ±4 ${periodWord} penceresi, en yakın liste ${fmtDateTr(ya.periodDate ?? ya.week)}`
  return `1 yıl önce liste yoktu — en yakın kayıt ${fmtDateTr(ya.periodDate ?? ya.week)}`
}

export default function ChartsStrip({ onSelectSeries }) {
  const [open, setOpen] = useState(true)
  const [week, setWeek] = useState(null)
  const [showYearAgo, setShowYearAgo] = useState(false)
  const [onlySeries, setOnlySeries] = useState(true)

  const global = useAsync(() => fetchGlobalTop(week), [week])
  const tv = useAsync(() => fetchTurkeyTv({ onlySeries }), [onlySeries])

  const g = global.data
  const t = tv.data
  const gItems = g?.status === 'hesaplandi' ? (showYearAgo ? g.yearAgo?.items || [] : g.items) : []
  const tItems = t?.status === 'hesaplandi' ? (showYearAgo ? t.yearAgo?.entries || [] : t.items) : []

  return (
    <section className={open ? 'charts-strip charts-strip--open' : 'charts-strip'} aria-label="Zirvedekiler">
      <div className="charts-strip__bar">
        <button type="button" className="charts-strip__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '▾' : '▸'} Zirvedekiler
          {g?.status === 'hesaplandi' && g.items[0] ? (
            <span className="charts-strip__teaser">
              {' '}
              · bu hafta {g.items[0].name}, {g.items[0].countries} ülkede Top 10
            </span>
          ) : null}
        </button>
        {open && g?.weeks?.length > 0 && (
          <label className="charts-strip__control">
            Hafta
            <select value={week ?? g.week} onChange={(e) => setWeek(e.target.value)} aria-label="Netflix haftası">
              {[...g.weeks].reverse().map((w) => (
                <option key={w} value={w}>
                  {fmtDateTr(w)}
                </option>
              ))}
            </select>
          </label>
        )}
        {open && (
          <button
            type="button"
            className={showYearAgo ? 'charts-strip__btn charts-strip__btn--active' : 'charts-strip__btn'}
            onClick={() => setShowYearAgo((v) => !v)}
            aria-pressed={showYearAgo}
          >
            1 yıl önce
          </button>
        )}
      </div>

      {open && (
        <div className="charts-strip__panels">
          <div className="charts-strip__panel">
            <h4 className="charts-strip__title">
              Netflix Top 10 —{' '}
              {showYearAgo ? yearAgoLabel(g?.yearAgo, 'hafta') || '1 yıl önce' : `bu hafta (${fmtDateTr(g?.week)})`}
            </h4>
            {global.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {global.status === 'error' && <p className="dashboard__empty">Liste alınamadı: {global.error}</p>}
            {g && g.status !== 'hesaplandi' && <p className="dashboard__empty">{g.reason}</p>}
            {g?.status === 'hesaplandi' && (
              <>
                <ChartList
                  compact
                  periodWord="ülke"
                  items={gItems.slice(0, 5).map((it, i) => ({
                    rank: i + 1,
                    seriesId: it.seriesId,
                    name: it.name,
                    kind: 'series',
                    periods: it.countries,
                    meta: `${it.top3} ülkede ilk 3 · en iyi #${it.bestRank}`,
                  }))}
                  emptyText={EMPTY.chartEmptyWeek}
                  onSelect={onSelectSeries}
                />
                <ChartSource source={g.source} periodLabel="haftalık" />
              </>
            )}
          </div>

          <div className="charts-strip__panel">
            <h4 className="charts-strip__title">
              Türkiye TV —{' '}
              {showYearAgo
                ? yearAgoLabel(t?.yearAgo, 'hafta') || '1 yıl önce'
                : `${fmtDateTr(t?.date)} (${t?.segment ?? 'Total'})`}
              <label className="charts-strip__filter">
                <input type="checkbox" checked={onlySeries} onChange={(e) => setOnlySeries(e.target.checked)} />{' '}
                yalnızca diziler
              </label>
            </h4>
            {tv.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {tv.status === 'error' && <p className="dashboard__empty">Liste alınamadı: {tv.error}</p>}
            {t && t.status !== 'hesaplandi' && <p className="dashboard__empty">{t.reason}</p>}
            {t?.status === 'hesaplandi' && (
              <>
                <ChartList
                  compact
                  periodWord="gün"
                  items={tItems.slice(0, 5)}
                  emptyText={onlySeries && t.hiddenCount ? EMPTY.chartOnlyOthers(t.hiddenCount) : EMPTY.chartEmptyDay}
                  onSelect={onSelectSeries}
                  showKind={!onlySeries}
                />
                <ChartSource source={t.source} periodLabel={`günlük · ${t.days?.length ?? 0} gün arşiv`} />
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
