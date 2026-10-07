import countryNames from '../../data/country-centroids.json'
import { fmtDate, fmtNum, fmtPct, fmtPeriod, fmtSignedPct, fmtWeek } from './format.js'
import { EMPTY } from '../../lib/emptyStates.js'
import { TrendBadge } from '../ChartList.jsx'
import SeriesTrendChart from '../SeriesTrendChart.jsx'

// Bölüm görünümleri: yalnızca sunucudan gelen `data`yı basar, hiçbir sayı burada türetilmez
// (rapor sözleşmesi ulke-raporu-v1). Grafikler saf SVG — SSR ve baskıda aynı çıktı.

const countryName = (iso2) => countryNames[iso2]?.name || iso2

function Kpi({ label, value, hint, warn }) {
  return (
    <div className="report__kpi">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint && <small className={warn ? 'report__kpi-warn' : undefined}>{hint}</small>}
    </div>
  )
}

function BarList({ rows, labelKey, valueKey, format, ariaLabel }) {
  const max = Math.max(...rows.map((r) => r[valueKey] || 0), 1)
  return (
    <div className="benchmark-card report__bars" role="list" aria-label={ariaLabel}>
      <div className="benchmark-card__bars">
        {rows.map((r) => (
          <div key={r[labelKey]} className="benchmark-card__row" role="listitem">
            <div className="benchmark-card__row-label">{r[labelKey]}</div>
            <div className="benchmark-card__row-bar-track">
              <div className="benchmark-card__row-bar" style={{ width: `${((r[valueKey] || 0) / max) * 100}%` }} />
            </div>
            <div className="benchmark-card__row-value">{format(r[valueKey])}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Aylık ortalama skor çubukları — 12 sütun, sabit yükseklik; tablo yerine tek satırlık grafik. */
function MonthlyBars({ monthly, label }) {
  const W = 600
  const H = 150
  const padB = 22
  const padT = 14
  const max = Math.max(...monthly.map((m) => m.avgScore || 0), 1)
  const slot = W / Math.max(monthly.length, 1)
  const barW = Math.min(36, slot * 0.6)
  return (
    <svg
      className="report__chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label || `Aylık ortalama yayın varlığı, ${monthly.length} ay`}
    >
      {monthly.map((m, i) => {
        const h = ((m.avgScore || 0) / max) * (H - padB - padT)
        const x = i * slot + (slot - barW) / 2
        const y = H - padB - h
        return (
          <g key={m.period}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="3"
              className={m.isCurrent ? 'report__bar--current' : undefined}
            />
            <text x={x + barW / 2} y={y - 3} textAnchor="middle" className="report__chart-value">
              {fmtNum(m.avgScore, 0)}
            </text>
            <text x={x + barW / 2} y={H - 6} textAnchor="middle">
              {fmtPeriod(m.period)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function ScoresSection({ data }) {
  return (
    <>
      <dl className="report__kpis">
        <Kpi
          label="İzlenme düzeyi"
          value={data.level ?? 'sinyal yetersiz'}
          hint={
            data.index != null
              ? `yüzdelik konum ${data.index}/100 · güven ${data.confidence}`
              : 'en az iki kaynak gerekir'
          }
          warn={data.level == null}
        />
        <Kpi
          label="Yayın varlığı"
          value={data.access ? `${data.access.seriesCount} dizi` : '—'}
          hint={data.access ? `${data.access.platformCount} platformda` : 'sağlayıcı verisi yok'}
        />
        <Kpi label="Baskın tema" value={data.dominantTheme ?? '—'} />
      </dl>
      {(data.warnings || [])
        .filter((w) => w.code === 'linear-tv')
        .map((w) => (
          <p key={w.code} className="report__caveat" role="note">
            ⚠ {w.text}
          </p>
        ))}
    </>
  )
}

function RankingSection({ data }) {
  return (
    <dl className="report__kpis">
      <Kpi
        label="İzlenme sırası"
        value={data.rank != null ? `${data.rank}. / ${data.of}` : '—'}
        hint="izlenme düzeyi hesaplanan ülkeler arasında; Türkiye dahil değil"
      />
      <Kpi label="Düzey" value={data.level ?? '—'} hint={data.confidence ? `güven ${data.confidence}` : undefined} />
    </dl>
  )
}

function TrendSection({ data }) {
  const st = data.shortTerm
  const monthly = data.monthly || []
  const zirve = monthly.reduce((a, m) => (a == null || (m.avgScore || 0) > (a.avgScore || 0) ? m : a), null)
  return (
    <>
      {st && (
        <p className="report__lead">
          Kısa vade ({st.windowDays} gün): <strong>{st.direction}</strong>
          {st.changePct != null && <> · {fmtSignedPct(st.changePct, 1)}</>}
        </p>
      )}
      {monthly.length > 0 ? (
        <>
          <MonthlyBars monthly={monthly} />
          {zirve && (
            <p className="report__fine">
              En yüksek ay: {fmtPeriod(zirve.period)} ({fmtNum(zirve.avgScore, 1)} puan
              {zirve.sampleCount != null ? `, ${zirve.sampleCount} ölçüm` : ''}). Son ay kısmi olabilir.
            </p>
          )}
        </>
      ) : (
        <p className="dashboard__empty">Aylık geçmiş henüz yok.</p>
      )}
    </>
  )
}

function FindingsSection({ data }) {
  return (
    <>
      <ol className="report__findings">
        {data.items.map((f, i) => (
          <li key={i}>
            {f.text}
            {f.basis && <span className="report__basis"> [{f.basis}]</span>}
          </li>
        ))}
      </ol>
      {data.dropped > 0 && (
        <p className="report__fine">
          {data.dropped} aday bulgu, doğrulanamadığı veya yönlendirme içerdiği için elendi.
        </p>
      )}
    </>
  )
}

function ImdbCell({ imdb }) {
  if (!imdb) return '—'
  return (
    <>
      {fmtNum(imdb.rating, 1)} ({fmtNum(imdb.votes, 0)} oy)
      {imdb.growth7?.votes > 0 && (
        <span className="report__basis">
          {' '}
          · son {imdb.growth7.days} gün +{fmtNum(imdb.growth7.votes, 0)}
        </span>
      )}
    </>
  )
}

function TopSeriesSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Dizi</th>
          <th scope="col">Bileşik skor</th>
          <th scope="col">İzleyici puanı</th>
        </tr>
      </thead>
      <tbody>
        {data.entries.map((e, i) => (
          <tr key={e.tmdbId}>
            <td>{i + 1}</td>
            <td>{e.name}</td>
            <td>{fmtNum(e.compositeScore, 0)}</td>
            <td>
              <ImdbCell imdb={e.imdb} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ThemesSection({ data }) {
  return (
    <>
      <BarList
        rows={data.items}
        labelKey="theme"
        valueKey="sharePct"
        format={(v) => fmtPct(v, 1)}
        ariaLabel="Tema payları"
      />
      <p className="report__fine">{data.seriesCount} dizinin popülerlik ağırlıklı tema payları.</p>
    </>
  )
}

// Dizi sayfasından açılan arama ilgisi ekranıyla aynı grafik (zirve etiketi, üzerine gelince değer); dizi
// başına bir grafik, kapsam bu ülke.
function SearchTrendSection({ data }) {
  const scope = data.iso2 ? countryName(data.iso2) : null
  return (
    <>
      {data.series.map((s) => (
        <div key={s.tmdbId} className="report__search-series">
          <p className="report__lead">
            <strong>{s.name}</strong>
          </p>
          <SeriesTrendChart timeline={s.timeline} scopeLabel={scope} />
        </div>
      ))}
    </>
  )
}

function PressToneSection({ data }) {
  const mt = data.mediaTone
  return (
    <>
      <dl className="report__kpis">
        <Kpi label="Olumlu haber oranı" value={fmtPct(mt.value, 1)} hint={`${mt.sampleSize} dizi taraması`} />
        {data.scanCount != null && <Kpi label="Toplam tarama" value={String(data.scanCount)} />}
      </dl>
      {data.scannedSeries?.length > 0 && (
        <table className="dashboard__table dashboard__table--compact report__table">
          <thead>
            <tr>
              <th scope="col">Dizi</th>
              <th scope="col">Haber</th>
              <th scope="col">Olumlu</th>
              <th scope="col">Baskın ton</th>
            </tr>
          </thead>
          <tbody>
            {data.scannedSeries.map((t) => (
              <tr key={t.tmdbId}>
                <td>{t.name || `#${t.tmdbId}`}</td>
                <td>{fmtNum(t.newsCount, 0)}</td>
                <td>{fmtPct(t.positivePct, 1)}</td>
                <td>{t.sentiment || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function HighlightedSeriesSection({ data }) {
  return (
    <>
      <p className="report__lead">Kriter: {data.criteria}</p>
      <ol className="report__findings">
        {data.items.map((s) => (
          <li key={s.tmdbId}>
            <strong>{s.name}</strong> — bileşik skor {fmtNum(s.compositeScore, 0)}
            {s.confidence ? `, ${s.confidence}` : ''}
            {s.imdb ? `, izleyici puanı ${fmtNum(s.imdb.rating, 1)}` : ''}
            {s.evidence?.length > 0 && <span className="report__basis"> ({s.evidence.join('; ')})</span>}
          </li>
        ))}
      </ol>
    </>
  )
}

// Değişim sütununun dayanağı: geçen haftanın sıralaması ya da (geçen hafta bu haftanın listelerini kapsamıyorsa)
// hafta içinde ilk günün sırası.
function trendCaption({ trendBasis, trendSince }) {
  if (trendBasis === 'week') return 'Değişim geçen haftanın sıralamasına göredir.'
  if (trendBasis === 'days') return `Değişim hafta içinde, ${fmtDate(trendSince)} sıralamasına göredir.`
  return null
}

function PlatformListsSection({ data }) {
  const { now = [], top = [], window: win, seriesCount = 0 } = data
  const caption = trendCaption(data)
  return (
    <>
      <dl className="report__kpis">
        <Kpi
          label="Bu hafta sıralamada"
          value={`${now.length} dizi`}
          hint={win ? `hafta sonu ${fmtDate(win.to)}` : ''}
        />
        {win && (
          <Kpi
            label={`Son ${win.weeks} haftada sıralamaya giren`}
            value={`${seriesCount} dizi`}
            hint={`${fmtDate(win.from)} – ${fmtDate(win.to)}`}
          />
        )}
      </dl>
      {now.length === 0 ? (
        <p className="report__lead">Bu hafta sıralamada Türk dizisi yok.</p>
      ) : (
        <table className="dashboard__table dashboard__table--compact report__table">
          <caption className="report__caption">Bu hafta</caption>
          <thead>
            <tr>
              <th scope="col">Sıra</th>
              <th scope="col">Dizi</th>
              <th scope="col">Listede</th>
              <th scope="col">Değişim</th>
            </tr>
          </thead>
          <tbody>
            {now.map((r) => (
              <tr key={`${r.seriesId ?? r.name}`}>
                <td>{r.position}</td>
                <td>{r.name}</td>
                <td>{r.weeks} hafta</td>
                <td>
                  <TrendBadge trend={r.trend} withCount />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {now.length > 0 && caption && <p className="report__fine">{caption}</p>}
      {top.length > 0 && (
        <table className="dashboard__table dashboard__table--compact report__table">
          <caption className="report__caption">Son {win?.weeks ?? 52} haftanın en kalıcıları</caption>
          <thead>
            <tr>
              <th scope="col">Dizi</th>
              <th scope="col">Listede kaldığı hafta</th>
              <th scope="col">En iyi sıra</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.seriesId ?? r.name}`}>
                <td>{r.name}</td>
                <td>{r.weeks}</td>
                <td>{r.bestPosition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function WikiInterestSection({ data }) {
  return (
    <>
      {data.languages.map((l) => (
        <div key={l.lang} className="brief__wiki">
          <p className="report__lead">
            <strong>{l.languageName}</strong>
          </p>
          <MonthlyBars
            monthly={l.months.map((m) => ({ period: m.period, avgScore: m.views }))}
            label={`${l.languageName} aylık okunma, ${l.months.length} ay`}
          />
          {l.top.length > 0 && <p className="report__caption">En çok okunan diziler</p>}
          {l.top.length > 0 && (
            <BarList
              rows={l.top}
              labelKey="name"
              valueKey="views"
              format={(v) => fmtNum(v, 0)}
              ariaLabel={`${l.languageName} en çok okunan diziler (12 ay)`}
            />
          )}
        </div>
      ))}
    </>
  )
}

function ForeignStudentsSection({ data }) {
  const max = Math.max(...data.series.map((r) => r.students), 1)
  return (
    <>
      <dl className="report__kpis">
        <Kpi label={`${data.year} yılında`} value={`${fmtNum(data.students, 0)} öğrenci`} />
        {data.changePct != null && (
          <Kpi
            label={`${data.baseYear}'e göre`}
            value={`${data.changePct >= 0 ? '+' : ''}${fmtNum(data.changePct, 0)}%`}
            hint="5 yıllık değişim"
          />
        )}
        {data.rank != null && (
          <Kpi label="Ülkeler arasında" value={`${data.rank}. / ${data.of}`} hint="öğrenci sayısına göre" />
        )}
      </dl>
      <div className="report__years" role="img" aria-label={`Yıllara göre öğrenci sayısı, ${data.series.length} yıl`}>
        {data.series.map((r) => (
          <div key={r.year} className="report__year">
            <span className="report__year-bar" style={{ height: `${Math.max(2, (r.students / max) * 100)}%` }} />
            <span className="report__year-label">{String(r.year).slice(2)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function NetflixHistorySection({ data }) {
  const src = data.sourceCoverage
  if (data.zeroRecords) {
    return (
      <>
        <p className="report__lead">{data.message}</p>
        <dl className="report__kpis">
          <Kpi
            label="Kaynak dosyanın kapsadığı dönem"
            value={`${fmtWeek(src?.firstWeek)} – ${fmtWeek(src?.lastWeek)}`}
            hint={src?.complete === false ? 'kısmi dosya; bu ülkenin bloğu tam okundu' : 'tam dosya'}
          />
          <Kpi label="Top 10 kaydı" value="0" hint="katalogdaki Türk dizileri arasından" />
        </dl>
      </>
    )
  }
  return (
    <>
      <dl className="report__kpis">
        <Kpi
          label="Ülkenin kapsanan dönemi"
          value={`${fmtWeek(data.coverage?.firstWeek)} – ${fmtWeek(data.coverage?.lastWeek)}`}
          hint="katalogdaki Türk dizilerinin ilk ve son Top 10 haftası"
        />
        <Kpi
          label="Kaynak dosyanın son haftası"
          value={fmtWeek(src?.lastWeek)}
          hint={
            src?.lastWeek
              ? `${fmtWeek(src.firstWeek)} itibarıyla ${src.complete === false ? 'kısmi' : src.complete ? 'tam' : ''} dosya`.trim()
              : 'bilinmiyor'
          }
        />
        {data.weeksBehindSource != null && (
          <Kpi
            label="Son kayıt ile fark"
            value={`${data.weeksBehindSource} hafta`}
            warn={data.weeksBehindSource >= 8}
          />
        )}
      </dl>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            <th scope="col">Netflix adı</th>
            <th scope="col">Top 10 hafta</th>
            <th scope="col">En iyi sıra</th>
            <th scope="col">İlk hafta</th>
            <th scope="col">Son hafta</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.tmdbId}>
              <td>{r.name}</td>
              <td>{r.netflixTitle}</td>
              <td>{r.weeksInTop10}</td>
              <td>{r.peakRank}</td>
              <td>{fmtWeek(r.firstWeek)}</td>
              <td>{fmtWeek(r.lastWeek)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

const POOL_LABELS = {
  bolge: 'aynı bölge',
  'bolge+gelir': 'aynı bölge, aynı gelir grubuyla tamamlandı',
  tumu: 'tüm ülkeler (bölge/gelir verisi yok)',
}

function GapAnalysisSection({ data }) {
  return (
    <>
      <h4 className="report__subtitle">
        Benzer ülkeler <span className="report__badge">deneysel</span>
      </h4>
      <ul className="report__similar">
        {data.similarCountries.map((c) => (
          <li key={c.iso2}>
            <strong>{countryName(c.iso2)}</strong>
            {c.reasons?.length > 0 && <span className="report__basis"> — {c.reasons.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <p className="report__fine">Aday havuzu: {POOL_LABELS[data.pool] || data.pool}.</p>
      <h4 className="report__subtitle">Benzer ülkelerde yayında olup bu ülkede olmayan diziler</h4>
      {data.items.length === 0 ? (
        <p className="report__lead report__lead--ok">{data.message || EMPTY.gapNone}</p>
      ) : (
        <table className="dashboard__table dashboard__table--compact report__table">
          <thead>
            <tr>
              <th scope="col">Dizi</th>
              <th scope="col">Yayında olduğu benzer ülkeler</th>
              <th scope="col">Benzer ülkelerde en iyi sıra</th>
              <th scope="col">Boşluk puanı</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.tmdbId}>
                <td>{g.name}</td>
                <td>{g.availableIn.map(countryName).join(', ')}</td>
                <td>{g.listBest ? `#${g.listBest.position} (${countryName(g.listBest.iso2)})` : '—'}</td>
                <td>{fmtNum(g.gapScore, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.totalGaps > data.items.length && (
        <p className="report__fine">
          İlk {data.items.length} gösteriliyor; toplam {data.totalGaps} boşluk.
        </p>
      )}
    </>
  )
}

const ok = (x) => x?.status === 'hesaplandi'
const artti = (pct) => (pct >= 0 ? 'arttı' : 'azaldı')
const yuzde = (pct) => `%${fmtNum(Math.abs(pct), 1)}`
const periodRange = (w) =>
  String(w)
    .split('→')
    .map((p) => fmtPeriod(p.trim()))
    .join(' – ')

/**
 * Turizm ilgisi: teknik göstergeler yerine sade cümleler; yalnızca hesaplanan maddeler (2026-10-07, kullanıcı
 * isteği — "—" ve teknik gerekçe satırları kaldırıldı). Cümleler sayılardan kurallarla kurulur, yorum eklenmez.
 */
export function tourismSentences(data) {
  const out = []
  const a = data.arrivals
  if (ok(a)) out.push(`Bu ülkeden Türkiye'ye son ayda (${fmtPeriod(a.latest)}) ${fmtNum(a.value, 0)} ziyaretçi geldi.`)
  const c = data.correlation
  if (ok(c)) {
    const gecikme = c.lagMonths ? `yaklaşık ${c.lagMonths} ay arayla ` : 'aynı aylarda '
    out.push(
      c.significant
        ? `Dizilere ait ansiklopedi okunması ile ziyaretçi sayısı ${gecikme}${c.value >= 0 ? 'birlikte artıp azalıyor' : 'ters yönde hareket ediyor'} (${c.sampleSize} aylık veri, istatistiksel olarak anlamlı).`
        : `Dizilere ait ansiklopedi okunması ile ziyaretçi sayısı arasında anlamlı bir ilişki bulunmadı (${c.sampleSize} aylık veri).`
    )
  }
  const d = data.didEstimate
  if (ok(d)) {
    const fark = d.treatmentChangePct - d.controlChangePct
    const adlar = (d.controls || []).map((c) => countryName(c.iso2))
    const grup =
      adlar.length > 1
        ? `benzer ${adlar.length} ülkede (${adlar.join(', ')}) ortalama`
        : `benzer bir ülke olan ${adlar[0]} için`
    out.push(
      `${periodRange(d.window)} döneminde bu ülkeden gelen ziyaretçiler ${yuzde(d.treatmentChangePct)} ${artti(d.treatmentChangePct)}; ` +
        `${grup} değişim ${yuzde(d.controlChangePct)} ${d.controlChangePct >= 0 ? 'artış' : 'azalış'}. ` +
        `Yani bu ülke, benzerlerinden ${fmtNum(Math.abs(fark), 1)} puan ${fark >= 0 ? 'daha iyi' : 'daha kötü'} seyretti.`
    )
  }
  const l = data.leadingSignal
  if (ok(l)) {
    out.push(
      `Diziye yönelik aramalar ile Türkiye'ye seyahat aramaları ${l.lagWeeks} hafta arayla ${l.value >= 0 ? 'birlikte hareket ediyor' : 'ters yönde hareket ediyor'} (${l.sampleSize} haftalık veri, keşif amaçlı).`
    )
  }
  return out
}

function TourismSignalSection({ data }) {
  const items = tourismSentences(data)
  if (!items.length) return <p className="report__lead">Bu ülke için turizm verisi yok.</p>
  return (
    <ul className="brief__sentences">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )
}

export const SECTION_COMPONENTS = {
  scores: ScoresSection,
  platformLists: PlatformListsSection,
  wikiInterest: WikiInterestSection,
  foreignStudents: ForeignStudentsSection,
  ranking: RankingSection,
  trend: TrendSection,
  findings: FindingsSection,
  topSeries: TopSeriesSection,
  themes: ThemesSection,
  searchTrend: SearchTrendSection,
  pressTone: PressToneSection,
  highlightedSeries: HighlightedSeriesSection,
  netflixHistory: NetflixHistorySection,
  gapAnalysis: GapAnalysisSection,
  tourismSignal: TourismSignalSection,
}
