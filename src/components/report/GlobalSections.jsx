import countryNames from '../../data/country-centroids.json'
import Flag from '../Flag.jsx'
import { fmtNum } from './format.js'

// Küresel görünüm bölümleri (sözleşme kuresel-brifing-v1). Yalnızca sunucudan gelen `data`yı basar.

const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const signed = (n, d = 0) => `${n > 0 ? '+' : ''}${fmtNum(n, d)}`
const TONE = { positive: 'Olumlu', neutral: 'Nötr', negative: 'Olumsuz' }

function Country({ iso2 }) {
  return (
    <span className="report__country">
      <Flag iso2={iso2} /> {nameOf(iso2)}
    </span>
  )
}

function Bars({ rows, label, value, format = (v) => fmtNum(v, 0), ariaLabel }) {
  const max = Math.max(...rows.map((r) => r[value] || 0), 1)
  return (
    <div className="benchmark-card report__bars" role="list" aria-label={ariaLabel}>
      <div className="benchmark-card__bars">
        {rows.map((r, i) => (
          <div key={i} className="benchmark-card__row" role="listitem">
            <div className="benchmark-card__row-label">{label(r)}</div>
            <div className="benchmark-card__row-bar-track">
              <div className="benchmark-card__row-bar" style={{ width: `${((r[value] || 0) / max) * 100}%` }} />
            </div>
            <div className="benchmark-card__row-value">{format(r[value])}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GlobalMarketsSection({ data }) {
  return (
    <>
      <p className="report__lead">
        Bu hafta {data.countryCount} ülkenin sıralamasında en az bir Türk dizisi var
        {data.previousCountryCount != null ? ` (geçen hafta ${data.previousCountryCount})` : ''}.
      </p>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Ülke</th>
            <th scope="col">Türk dizisi</th>
            <th scope="col">İlk sırada</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.iso2}>
              <td>
                <Country iso2={r.iso2} />
              </td>
              <td>{r.count}</td>
              <td>{r.top ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function GlobalSeriesSection({ data }) {
  return (
    <Bars
      rows={data.rows}
      label={(r) => r.name}
      value="countryCount"
      format={(v) => `${v} ülke`}
      ariaLabel="En çok ülkede sıralamada olan diziler"
    />
  )
}

export function GlobalThemesSection({ data }) {
  return (
    <Bars
      rows={data.rows}
      label={(r) => `${r.theme} (${r.seriesCount} dizi)`}
      value="sharePct"
      format={(v) => `%${fmtNum(v, 1)}`}
      ariaLabel="Tema dağılımı"
    />
  )
}

export function GlobalStudentsSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Ülke</th>
          <th scope="col">{data.year} öğrenci</th>
          <th scope="col">{data.baseYear}'e göre</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((r) => (
          <tr key={r.iso2}>
            <td>
              <Country iso2={r.iso2} />
            </td>
            <td>{fmtNum(r.students, 0)}</td>
            <td>{r.changePct != null ? `${signed(r.changePct)}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TurkishLearningSection({ data }) {
  return (
    <>
      {data.learners && (
        <dl className="report__kpis">
          <div className="report__kpi">
            <dt>Dil öğrenme uygulamasında Türkçe öğrenen</dt>
            <dd>{fmtNum(data.learners.total, 0)}</dd>
            {data.learners.changePct != null && <small>son ayda {signed(data.learners.changePct, 1)}%</small>}
          </div>
        </dl>
      )}
      {data.items.length > 0 && (
        <>
          <p className="report__caption">Türkçe öğrenme aramalarının göreli yoğunluğu (0–100)</p>
          <Bars rows={data.items} label={(r) => nameOf(r.iso2)} value="value" ariaLabel="Türkçe öğrenme ilgisi" />
        </>
      )}
    </>
  )
}

export function GlobalPressSection({ data }) {
  return (
    <>
      <dl className="report__kpis">
        <div className="report__kpi">
          <dt>Olumlu</dt>
          <dd>%{fmtNum(data.positivePct, 0)}</dd>
          <small>{data.sampleSize} dizi/ülke ölçümü</small>
        </div>
        <div className="report__kpi">
          <dt>Olumsuz</dt>
          <dd>%{fmtNum(data.negativePct, 0)}</dd>
        </div>
      </dl>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Ülke</th>
            <th scope="col">Olumlu</th>
            <th scope="col">Ton</th>
            <th scope="col">Dizi</th>
          </tr>
        </thead>
        <tbody>
          {data.countries.map((c) => (
            <tr key={c.iso2}>
              <td>
                <Country iso2={c.iso2} />
              </td>
              <td>%{fmtNum(c.positivePct, 0)}</td>
              <td>{TONE[c.tone] ?? c.tone}</td>
              <td>{c.seriesCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function GlobalDestinationsSection({ data }) {
  return (
    <Bars
      rows={data.rows}
      label={(r) => `${r.name} (${r.seriesCount} dizi)`}
      value="sharePct"
      format={(v) => `%${fmtNum(v, 1)}`}
      ariaLabel="Dizilerde öne çıkan destinasyonlar"
    />
  )
}

export function ReadingTourismSection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.tested} ülkede ölçüldü; {data.significantCount} ülkede istatistiksel olarak anlamlı ilişki var (bu kadar
        ülkede rastlantıyla ~{String(data.expectedByChance).replace('.', ',')} beklenir). {data.sharedLanguage} ülke,
        dili birden çok ülkede konuşulduğu için ölçülemedi.
      </p>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Ülke</th>
            <th scope="col">İlişki (r)</th>
            <th scope="col">Gecikme</th>
            <th scope="col">Ay</th>
            <th scope="col">Sonuç</th>
          </tr>
        </thead>
        <tbody>
          {data.items.slice(0, 12).map((i) => (
            <tr key={i.iso2}>
              <td>
                <Country iso2={i.iso2} />
              </td>
              <td>{signed(i.r, 2)}</td>
              <td>{i.lagMonths} ay</td>
              <td>{i.n}</td>
              <td>{i.significant ? (i.r > 0 ? 'Anlamlı, aynı yönde' : 'Anlamlı, ters yönde') : 'Anlamlı değil'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function TravelSignalSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Ülke</th>
          <th scope="col">Dizi</th>
          <th scope="col">Birlikte hareket (r)</th>
          <th scope="col">Hafta</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.iso2}>
            <td>
              <Country iso2={r.iso2} />
            </td>
            <td>{r.seriesName ?? '—'}</td>
            <td>{signed(r.r, 2)}</td>
            <td>{r.weeks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function GlobalReachSection({ data }) {
  return (
    <>
      <p className="report__lead">Türk dizileri {data.countryCount} ülkede abonelikle ya da ücretsiz izlenebiliyor.</p>
      <Bars
        rows={data.top}
        label={(r) => nameOf(r.iso2)}
        value="seriesCount"
        format={(v) => `${v} dizi`}
        ariaLabel="En çok Türk dizisinin yayında olduğu ülkeler"
      />
      {data.rising.length > 0 && (
        <p className="report__fine">
          Erişimi artan ülkeler: {data.rising.map((r) => `${nameOf(r.iso2)} (${signed(r.changePct, 0)}%)`).join(', ')}.
        </p>
      )}
    </>
  )
}

export function BenchmarkSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Ülke</th>
          <th scope="col">Popülerlik payı</th>
          <th scope="col">Dizilerinin yayında olduğu ülke</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.code} className={r.code === 'TR' ? 'report__row--highlight' : undefined}>
            <td>{r.name}</td>
            <td>%{fmtNum(r.sharePct, 1)}</td>
            <td>{r.countries ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export const GLOBAL_SECTION_COMPONENTS = {
  globalMarkets: GlobalMarketsSection,
  globalSeries: GlobalSeriesSection,
  globalThemes: GlobalThemesSection,
  globalStudents: GlobalStudentsSection,
  turkishLearning: TurkishLearningSection,
  globalPress: GlobalPressSection,
  globalDestinations: GlobalDestinationsSection,
  readingTourism: ReadingTourismSection,
  travelSignal: TravelSignalSection,
  globalReach: GlobalReachSection,
  benchmark: BenchmarkSection,
}
