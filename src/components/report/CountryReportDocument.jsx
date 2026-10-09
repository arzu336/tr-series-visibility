import { SECTION_COMPONENTS } from './ReportSections.jsx'
import { SERIES_SECTION_COMPONENTS } from './SeriesSections.jsx'
import { GLOBAL_SECTION_COMPONENTS } from './GlobalSections.jsx'

const COMPONENTS = { ...SECTION_COMPONENTS, ...SERIES_SECTION_COMPONENTS, ...GLOBAL_SECTION_COMPONENTS }
import { fmtDateTime } from './format.js'

// Ülke brifingi (sözleşme ulke-brifingi-v1), dizi raporu ve küresel görünüm: özet kartı → başlıklar.
// Saf bileşen — ağ çağrısı yok; SSR testleri ve baskı ölçümü bunu doğrudan basar. Hangi bölümün hangi
// başlıkta, hangi sırayla görüneceğine sunucu karar verir (server/services/countryBriefing.js).

const TREND = {
  up: { mark: '▲', label: 'artış' },
  down: { mark: '▼', label: 'düşüş' },
  same: { mark: '–', label: 'değişim yok' },
}

function SummaryKpi({ kpi }) {
  const t = kpi.trend ? TREND[kpi.trend] : null
  return (
    <div className="brief__kpi">
      <dt>{kpi.label}</dt>
      <dd className="brief__kpi-value">
        {kpi.value}
        {t && (
          <span className={`brief__trend brief__trend--${kpi.trend}`} title={t.label} aria-label={t.label}>
            {t.mark}
          </span>
        )}
      </dd>
      {kpi.detail && <dd className="brief__kpi-detail">{kpi.detail}</dd>}
    </div>
  )
}

/**
 * Sunucu başlıkları + istemcideki canlı bölümler. `omit`: basılmayacak sunucu başlıkları. `extra`:
 * [{ key, title?, after, node }] — `after` başlığının hemen arkasına (aynı başlığa birden çok eklenirse sırayla), o
 * başlık yoksa sona eklenir.
 */
export function orderChapters(chapters = [], extra = [], omit = []) {
  const out = chapters.filter((c) => !omit.includes(c.key)).map((c) => ({ ...c, server: true }))
  for (const e of extra) {
    let i = out.findIndex((c) => c.key === e.after)
    if (i < 0) {
      out.push({ ...e, server: false })
      continue
    }
    while (i + 1 < out.length && !out[i + 1].server) i++
    out.splice(i + 1, 0, { ...e, server: false })
  }
  return out
}

/**
 * `hideHead`: başlık kartını dışarıdaki tanıtım kartı veriyor (dizi raporu). `omitChapters` / `extraChapters`: bkz.
 * orderChapters.
 */
export default function CountryReportDocument({
  report,
  countryName,
  hideHead = false,
  omitChapters = [],
  extraChapters = [],
}) {
  const summary = report.summary || { kpis: [], sentences: [] }
  const chapters = orderChapters(report.chapters, extraChapters, omitChapters)
  return (
    <article className="report__doc brief" lang="tr">
      {hideHead ? (
        <p className="report__meta">Hazırlanma: {fmtDateTime(report.generatedAt)}</p>
      ) : (
        <header className="report__head">
          <p className="report__kicker">{report.title || 'Ülke brifingi'}</p>
          <h1>{countryName}</h1>
          <p className="report__meta">Hazırlanma: {fmtDateTime(report.generatedAt)}</p>
        </header>
      )}

      {report.isTracked === false && (
        <p className="report__caveat" role="note">
          Bu ülke için yayın kataloğu verisi yok; brifing eldeki diğer verilerle (basın, okunma, öğrenci) sınırlı.
        </p>
      )}

      <section className="brief__summary" aria-labelledby="brifing-ozet">
        <h2 id="brifing-ozet" className="brief__summary-title">
          Özet
        </h2>
        <dl className="brief__kpis">
          {summary.kpis.map((k) => (
            <SummaryKpi key={k.key} kpi={k} />
          ))}
        </dl>
        {summary.sentences.length > 0 && (
          <ul className="brief__sentences">
            {summary.sentences.map((s) => (
              <li key={s.basis}>{s.text}</li>
            ))}
          </ul>
        )}
        {summary.caveat && (
          <p className="report__caveat" role="note">
            {summary.caveat}
          </p>
        )}
      </section>

      {chapters.map((ch) =>
        !ch.server && !ch.title ? (
          <div key={ch.key} id={`brifing-${ch.key}`} className="brief__live">
            {ch.node}
          </div>
        ) : (
          <section
            key={ch.key}
            className="brief__chapter"
            id={`brifing-${ch.key}`}
            aria-labelledby={`baslik-${ch.key}`}
          >
            <h2 id={`baslik-${ch.key}`} className="brief__chapter-title">
              {ch.title}
            </h2>
            {!ch.server && <div className="brief__live">{ch.node}</div>}
            {(ch.sections || []).map((sec) => {
              const Cmp = COMPONENTS[sec.key]
              return (
                <section key={sec.key} className="dashboard__section report__section" data-section={sec.key}>
                  <h3 className="dashboard__section-title">{sec.title}</h3>
                  {Cmp ? <Cmp data={sec.data} /> : null}
                  {sec.caveat && (
                    <p className="report__caveat" role="note">
                      {sec.caveat}
                    </p>
                  )}
                </section>
              )
            })}
          </section>
        )
      )}
    </article>
  )
}
