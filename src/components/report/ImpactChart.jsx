import { fmtNum, fmtPeriod } from './format.js'
import { IconSparkle } from '../Icons.jsx'

// Etki grafikleri (2026-10-16): iki aylık seri aynı grafikte, iki eksenli (sol: ziyaretçi ya da ihracat, sağ: okunma
// ilgisi). Pandemi yılları gri bant. Altında benzer ülke kıyası: bu ülke ile kontrol ortalamasının değişimi çubukla.

const W = 640
const H = 190
const PAD_L = 54
const PAD_R = 54
const PAD_T = 14
const PAD_B = 26
const PRIMARY = '#EE3135'
const SECONDARY = '#6FA8DC'
const PANDEMIC = ['2020-01', '2022-12']

const compact = (n) =>
  n >= 1e9
    ? `${fmtNum(n / 1e9, 1)} mr`
    : n >= 1e6
      ? `${fmtNum(n / 1e6, 1)} mn`
      : n >= 1e3
        ? `${fmtNum(n / 1e3, 0)} b`
        : fmtNum(n, 0)

function scale(values, top, bottom) {
  const finite = values.filter((v) => Number.isFinite(v))
  const max = Math.max(...finite, 1)
  return (v) => bottom - (v / max) * (bottom - top)
}

function path(points, y, xOf) {
  let d = ''
  points.forEach((p, i) => {
    if (!Number.isFinite(p.v)) return
    d += `${d ? ' L' : 'M'}${xOf(i).toFixed(1)},${y(p.v).toFixed(1)}`
  })
  return d
}

/**
 * `months`: [{ key: 'YYYY-MM', primary, secondary }] (eksik değer null). `labels`: { primary, secondary }.
 */
export function DualLineChart({ months, labels }) {
  if (!months || months.length < 6) return null
  const n = months.length
  const xOf = (i) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R)
  const top = PAD_T
  const bottom = H - PAD_B
  const yP = scale(
    months.map((m) => m.primary),
    top,
    bottom
  )
  const yS = scale(
    months.map((m) => m.secondary),
    top,
    bottom
  )
  const maxP = Math.max(...months.map((m) => m.primary).filter(Number.isFinite), 1)
  const maxS = Math.max(...months.map((m) => m.secondary).filter(Number.isFinite), 1)
  const first = months.findIndex((m) => m.key >= PANDEMIC[0] && m.key <= PANDEMIC[1])
  const last = months.map((m) => m.key >= PANDEMIC[0] && m.key <= PANDEMIC[1]).lastIndexOf(true)
  const yearTicks = months.map((m, i) => (m.key.endsWith('-01') ? i : -1)).filter((i) => i >= 0)
  const title = `${labels.primary} ve ${labels.secondary}, ${fmtPeriod(months[0].key)} – ${fmtPeriod(months[n - 1].key)}`
  return (
    <figure className="impact-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="impact-chart__svg">
        {first >= 0 && last >= first && (
          <rect
            x={xOf(first)}
            y={top}
            width={xOf(last) - xOf(first)}
            height={bottom - top}
            className="impact-chart__pandemic"
          />
        )}
        <line x1={PAD_L} y1={bottom} x2={W - PAD_R} y2={bottom} className="impact-chart__axis" />
        {yearTicks.map((i) => (
          <g key={months[i].key}>
            <line x1={xOf(i)} y1={bottom} x2={xOf(i)} y2={bottom + 4} className="impact-chart__axis" />
            <text x={xOf(i)} y={bottom + 16} textAnchor="middle" className="impact-chart__tick">
              {months[i].key.slice(0, 4)}
            </text>
          </g>
        ))}
        <text x={PAD_L - 6} y={top + 10} textAnchor="end" className="impact-chart__tick" fill={PRIMARY}>
          {compact(maxP)}
        </text>
        <text x={W - PAD_R + 6} y={top + 10} textAnchor="start" className="impact-chart__tick" fill={SECONDARY}>
          {compact(maxS)}
        </text>
        <path
          d={path(
            months.map((m) => ({ v: m.secondary })),
            yS,
            xOf
          )}
          fill="none"
          stroke={SECONDARY}
          strokeWidth="1.6"
          strokeDasharray="4 3"
        />
        <path
          d={path(
            months.map((m) => ({ v: m.primary })),
            yP,
            xOf
          )}
          fill="none"
          stroke={PRIMARY}
          strokeWidth="2"
        />
      </svg>
      <figcaption className="impact-chart__legend">
        <span>
          <i className="impact-chart__swatch" style={{ background: PRIMARY }} /> {labels.primary}
        </span>
        <span>
          <i className="impact-chart__swatch impact-chart__swatch--dashed" style={{ borderColor: SECONDARY }} />{' '}
          {labels.secondary}
        </span>
        {first >= 0 && <span className="impact-chart__note">Gri bant: pandemi yılları</span>}
      </figcaption>
    </figure>
  )
}

/** Yapay zekâ yorumu kutusu; yorum yoksa hiçbir şey çizmez. */
export function AiNote({ text }) {
  if (!text) return null
  return (
    <div className="theme-insight__ai-box impact-note">
      <span className="theme-insight__ai-label">
        <IconSparkle size={12} inline /> Yapay zekâ değerlendirmesi
      </span>
      <p>{text}</p>
    </div>
  )
}

/** Benzer ülke kıyası: bu ülke ve kontrol ortalaması (+ tek tek kontroller) yüzde değişim çubukları. */
export function ControlBars({ did, nameOf, label }) {
  if (!did || did.status !== 'hesaplandi') return null
  const rows = [
    { name: label, pct: did.treatmentChangePct, main: true },
    { name: 'Benzer ülkeler (ortalama)', pct: did.controlChangePct, main: true },
    ...(did.controls || []).map((c) => ({ name: nameOf(c.iso2), pct: c.changePct, main: false })),
  ].filter((r) => Number.isFinite(r.pct))
  const max = Math.max(...rows.map((r) => Math.abs(r.pct)), 1)
  return (
    <div
      className="control-bars"
      role="img"
      aria-label={`Benzer ülkelere göre değişim: ${rows.map((r) => `${r.name} %${fmtNum(r.pct, 1)}`).join(', ')}`}
    >
      {rows.map((r) => (
        <div key={r.name} className={`control-bars__row${r.main ? ' control-bars__row--main' : ''}`}>
          <span className="control-bars__name">{r.name}</span>
          <span className="control-bars__track">
            <span className="control-bars__zero" />
            <span
              className={`control-bars__bar${r.pct < 0 ? ' control-bars__bar--neg' : ''}`}
              style={{
                width: `${(Math.abs(r.pct) / max) * 50}%`,
                [r.pct < 0 ? 'right' : 'left']: '50%',
              }}
            />
          </span>
          <span className="control-bars__value">{`${r.pct < 0 ? '−' : '+'}%${fmtNum(Math.abs(r.pct), 1)}`}</span>
        </div>
      ))}
    </div>
  )
}
