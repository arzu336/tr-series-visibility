import countryNames from '../../data/country-centroids.json'
import { fmtDate, fmtNum, fmtPct, fmtPeriod, fmtSignedPct, fmtWeek } from './format.js'
import { EMPTY } from '../../lib/emptyStates.js'

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
function MonthlyBars({ monthly }) {
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
      aria-label={`Aylık ortalama yayın varlığı, ${monthly.length} ay`}
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

function Sparkline({ timeline, label }) {
  const W = 160
  const H = 36
  const vals = timeline.map((p) => p.value ?? 0)
  const max = Math.max(...vals, 1)
  const step = vals.length > 1 ? W / (vals.length - 1) : W
  const d = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`)
    .join(' ')
  return (
    <svg className="report__sparkline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d} fill="none" strokeWidth="1.5" />
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
          label="Netflix Top 10 (son 52 hafta)"
          value={data.netflix ? `${data.netflix.series} dizi · ${data.netflix.weeks} hafta` : '—'}
          hint={
            data.netflix
              ? data.netflix.bestRank
                ? `en iyi sıra ${data.netflix.bestRank}`
                : 'Türk dizisi girmedi'
              : data.netflixReason || 'Netflix bu pazarda liste yayımlamıyor'
          }
          warn={!data.netflix}
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

function TopSeriesSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Dizi</th>
          <th scope="col">Bileşik skor</th>
          <th scope="col">Kanıt</th>
          <th scope="col">Veri güveni</th>
        </tr>
      </thead>
      <tbody>
        {data.entries.map((e, i) => (
          <tr key={e.tmdbId}>
            <td>{i + 1}</td>
            <td>{e.name}</td>
            <td>{fmtNum(e.compositeScore, 0)}</td>
            <td>{(e.evidence || []).join('; ') || '—'}</td>
            <td className={`report__confidence report__confidence--${e.dataConfidence?.level || 'none'}`}>
              {e.dataConfidence?.label || '—'}
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

function SearchTrendSection({ data }) {
  const ozet = (tl) => {
    const vals = tl.map((p) => p.value ?? 0)
    const ort = vals.reduce((s, v) => s + v, 0) / Math.max(vals.length, 1)
    const zirveI = vals.indexOf(Math.max(...vals))
    return { ort, zirve: vals[zirveI], zirveTarih: tl[zirveI]?.timestamp, son: vals.at(-1) }
  }
  return (
    <>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            <th scope="col">12 aylık seyir</th>
            <th scope="col">Ortalama</th>
            <th scope="col">Zirve</th>
            <th scope="col">Son hafta</th>
          </tr>
        </thead>
        <tbody>
          {data.series.map((s) => {
            const o = ozet(s.timeline)
            return (
              <tr key={s.tmdbId}>
                <td>{s.name}</td>
                <td>
                  <Sparkline timeline={s.timeline} label={`${s.name} arama ilgisi seyri`} />
                </td>
                <td>{fmtNum(o.ort, 1)}</td>
                <td>
                  {fmtNum(o.zirve, 0)}
                  {o.zirveTarih ? ` (${fmtDate(o.zirveTarih * 1000)})` : ''}
                </td>
                <td>{fmtNum(o.son, 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="report__fine">
        Değerler Google Trends göreli ilgi endeksi (0–100, ülke içi). Önbellekteki son sorgu kullanıldı.
        {data.missing?.length > 0 && <> Sorgulanmamış: {data.missing.join(', ')}.</>}
      </p>
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
            {s.evidence?.length > 0 && <span className="report__basis"> ({s.evidence.join('; ')})</span>}
          </li>
        ))}
      </ol>
    </>
  )
}

const PLATFORM_GROUPS = [
  ['Abonelik', ['flatrate']],
  ['Ücretsiz / reklamlı', ['free', 'ads']],
  ['Kirala / satın al', ['rent', 'buy']],
]

function platformText(platforms, keys) {
  const list = keys.flatMap((k) => platforms?.[k] || [])
  return list.length > 0 ? Array.from(new Set(list)).join(', ') : '—'
}

function AvailabilitySection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.rows.length} dizinin sağlayıcı kaydı var; <strong>{data.streamableCount}</strong> tanesi abonelik veya
        ücretsiz yayında izlenebilir.
      </p>
      {data.platformSummary?.length > 0 && (
        <ul className="report__chips" aria-label="Platform özeti">
          {data.platformSummary.slice(0, 10).map((p) => (
            <li key={p.name} className="report__chip">
              {p.name} · {p.count}
            </li>
          ))}
        </ul>
      )}
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            {PLATFORM_GROUPS.map(([label]) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.tmdbId} className={r.streamable ? undefined : 'report__row--muted'}>
              <td>{r.name}</td>
              {PLATFORM_GROUPS.map(([label, keys]) => (
                <td key={label}>{platformText(r.platforms, keys)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
  bolge: 'aynı Dünya Bankası bölgesi',
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
              <th scope="col">Netflix en iyi sıra</th>
              <th scope="col">Boşluk puanı</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.tmdbId}>
                <td>{g.name}</td>
                <td>{g.availableIn.map(countryName).join(', ')}</td>
                <td>{g.netflixBest != null ? g.netflixBest : '—'}</td>
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

function SubSignal({ label, item, render }) {
  return (
    <div className="report__kpi">
      <dt>{label}</dt>
      {item?.status === 'hesaplandi' ? (
        render(item)
      ) : (
        <>
          <dd className="report__kpi--empty">—</dd>
          <small className="report__kpi-warn">{item?.reason || 'hesaplanamadı'}</small>
        </>
      )}
    </div>
  )
}

function TourismSignalSection({ data }) {
  return (
    <dl className="report__kpis report__kpis--tourism">
      <SubSignal
        label="Türkiye'ye gelen ziyaretçi"
        item={data.arrivals}
        render={(a) => (
          <>
            <dd>{fmtNum(a.value, 0)}</dd>
            <small>
              {a.monthCount} ay toplamı, son ay {fmtPeriod(a.latest)}
            </small>
          </>
        )}
      />
      <SubSignal
        label="Görünürlük–ziyaretçi korelasyonu"
        item={data.correlation}
        render={(c) => (
          <>
            <dd>{fmtNum(c.value, 2)}</dd>
            <small>{c.sampleSize != null ? `${c.sampleSize} ay` : ''}</small>
          </>
        )}
      />
      <SubSignal
        label="Fark-içinde-fark tahmini"
        item={data.didEstimate}
        render={(d) => (
          <>
            <dd>{fmtNum(d.value, 0)}</dd>
            <small>
              ziyaretçi farkı, kontrol {countryName(d.controlIso2)} ({d.controlReason}); ülke{' '}
              {fmtSignedPct(d.treatmentChangePct)}, kontrol {fmtSignedPct(d.controlChangePct)}; pencere {d.window}
            </small>
          </>
        )}
      />
      <SubSignal
        label="Öncü sinyal (seyahat aramaları)"
        item={data.leadingSignal}
        render={(l) => (
          <>
            <dd>{fmtNum(l.value, 2)}</dd>
            <small>
              {l.direction}, {l.lagWeeks} hafta gecikme, n={l.sampleSize}
              {l.significant ? ', anlamlı' : ', anlamlı değil'} · sorgu “{l.travelQuery}”
            </small>
          </>
        )}
      />
    </dl>
  )
}

export const SECTION_COMPONENTS = {
  scores: ScoresSection,
  ranking: RankingSection,
  trend: TrendSection,
  findings: FindingsSection,
  topSeries: TopSeriesSection,
  themes: ThemesSection,
  searchTrend: SearchTrendSection,
  pressTone: PressToneSection,
  highlightedSeries: HighlightedSeriesSection,
  availability: AvailabilitySection,
  netflixHistory: NetflixHistorySection,
  gapAnalysis: GapAnalysisSection,
  tourismSignal: TourismSignalSection,
}
