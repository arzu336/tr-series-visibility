import countryNames from '../../data/country-centroids.json'
import Flag from '../Flag.jsx'
import SeriesTrendChart from '../SeriesTrendChart.jsx'
import { fmtNum } from './format.js'

// Yıllık rapor bölümleri (sözleşme yillik-rapor-v1; server/services/yearReport.js). Yalnızca sunucunun `data`sını basar.

const nameOf = (iso2) => countryNames[iso2]?.name || iso2
const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const ayAdi = (m) => AYLAR[(typeof m === 'string' ? Number(m.slice(5, 7)) : m) - 1] ?? m
const PLATFORM = {
  netflix: 'Netflix',
  disney: 'Disney+',
  'amazon-prime': 'Prime Video',
  'hbo-max': 'HBO Max',
  'apple-tv': 'Apple TV+',
  shahid: 'Shahid',
  starz: 'STARZPLAY',
  vidio: 'Vidio',
}

function Flags({ list }) {
  return (
    <span className="report__flags">
      {list.map((iso2) => (
        <Flag key={iso2} iso2={iso2} title={nameOf(iso2)} />
      ))}
    </span>
  )
}

/** Aylık değerler için yatay çubuklar (en büyüğe göre). */
function MonthBars({ rows, valueKey, unit }) {
  const max = Math.max(...rows.map((r) => r[valueKey]), 1)
  // Dönem birden çok yıla yayılıyorsa ay adına yıl eklenir ("Tem 23").
  const years = new Set(rows.map((r) => (typeof r.month === 'string' ? r.month.slice(0, 4) : null)))
  const label = (m) => (years.size > 1 ? `${ayAdi(m)} ${m.slice(2, 4)}` : ayAdi(m))
  return (
    <div className="benchmark-card__bars">
      {rows.map((r) => (
        <div key={r.month} className="benchmark-card__row">
          <div className="benchmark-card__row-label">{label(r.month)}</div>
          <div className="benchmark-card__row-bar-track">
            <div className="benchmark-card__row-bar" style={{ width: `${(r[valueKey] / max) * 100}%` }} />
          </div>
          <div className="benchmark-card__row-value">
            {fmtNum(r[valueKey], 0)}
            {unit ? ` ${unit}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

export function YearListsSection({ data }) {
  return (
    <>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            <th scope="col">Listede</th>
            <th scope="col">En iyi sıra</th>
            <th scope="col">Platformlar</th>
          </tr>
        </thead>
        <tbody>
          {data.top.map((r) => (
            <tr key={r.seriesId}>
              <td>{r.name}</td>
              <td>{r.weeks} hafta</td>
              <td>{r.bestRank}.</td>
              <td>{r.platforms.map((p) => PLATFORM[p] ?? p).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.monthly.length > 1 && (
        <>
          <p className="report__caption">Ay ay listelere giren farklı dizi sayısı</p>
          <MonthBars rows={data.monthly} valueKey="series" unit="dizi" />
        </>
      )}
    </>
  )
}

export function YearTvSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Dizi</th>
          <th scope="col">Yayın</th>
          <th scope="col">Kanallar</th>
          <th scope="col">Ülkeler</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.seriesId}>
            <td>{r.name}</td>
            <td>{r.slots}</td>
            <td>{r.channels.join(', ')}</td>
            <td>
              <Flags list={r.countries} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function YearReadingSection({ data }) {
  return (
    <>
      <p className="report__lead">Toplam {fmtNum(data.total, 0)} okunma.</p>
      <ul className="report__platforms">
        {data.languages.slice(0, 6).map((l) => (
          <li key={l.lang}>
            <strong>{l.languageName}</strong> <span className="report__basis">{fmtNum(l.views, 0)} okunma</span>
          </li>
        ))}
      </ul>
      {data.top.length > 0 && (
        <table className="dashboard__table dashboard__table--compact report__table">
          <thead>
            <tr>
              <th scope="col">En çok okunan diziler</th>
              <th scope="col">Okunma</th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((r) => (
              <tr key={r.seriesId}>
                <td>{r.name}</td>
                <td>{fmtNum(r.views, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.monthly.length > 1 && (
        <>
          <p className="report__caption">Ay ay okunma</p>
          <MonthBars rows={data.monthly} valueKey="views" />
        </>
      )}
    </>
  )
}

export function YearWatchSection({ data }) {
  return (
    <dl className="report__kpis">
      <div className="report__kpi">
        <dt>Ortalama izlenme düzeyi</dt>
        <dd>{data.level}</dd>
        <small>
          endeks {data.avgIndex} · {data.days} günlük kayıt
        </small>
      </div>
    </dl>
  )
}

export function YearPressSection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.withNews} taramada {fmtNum(data.news, 0)} haber
        {data.positivePct != null ? ` · olumlu %${data.positivePct} · olumsuz %${data.negativePct}` : ''}.
      </p>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            <th scope="col">Haber</th>
            <th scope="col">Ülkeler</th>
          </tr>
        </thead>
        <tbody>
          {data.top.map((r) => (
            <tr key={r.seriesId}>
              <td>{r.name}</td>
              <td>{fmtNum(r.news, 0)}</td>
              <td>
                <Flags list={r.countries} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function YearTourismSection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.months} ayda {fmtNum(data.total, 0)} ziyaretçi
        {data.changePct != null
          ? `; önceki yılın aynı aylarına göre %${fmtNum(Math.abs(data.changePct), 1)} ${data.changePct >= 0 ? 'artış' : 'azalış'}`
          : ''}
        .
      </p>
      <MonthBars rows={data.monthly} valueKey="visitors" />
    </>
  )
}

export function YearStudentsSection({ data }) {
  return (
    <p className="report__lead">
      {fmtNum(data.students, 0)} öğrenci
      {data.prev ? ` (önceki yıl ${fmtNum(data.prev, 0)})` : ''}.
    </p>
  )
}

export function YearMarketsSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Ülke</th>
          <th scope="col">Listede</th>
          <th scope="col">En iyi sıra</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.slice(0, 25).map((r) => (
          <tr key={r.iso2}>
            <td>
              <span className="report__country">
                <Flag iso2={r.iso2} /> {nameOf(r.iso2)}
              </span>
            </td>
            <td>{r.weeks} hafta</td>
            <td>{r.bestRank}.</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function YearSearchSection({ data }) {
  return <SeriesTrendChart timeline={data.timeline} />
}

export function ContinentSeriesSection({ data }) {
  return (
    <>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Dizi</th>
            <th scope="col">Ülke</th>
            <th scope="col">Listede</th>
            <th scope="col">En iyi sıra</th>
            <th scope="col">Ülkeler</th>
          </tr>
        </thead>
        <tbody>
          {data.top.map((r) => (
            <tr key={r.seriesId}>
              <td>{r.name}</td>
              <td>{r.countries.length}</td>
              <td>{r.countryWeeks} ülke-hafta</td>
              <td>{r.bestRank}.</td>
              <td>
                <Flags list={r.countries.slice(0, 8)} />
                {r.countries.length > 8 ? ` +${r.countries.length - 8}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="report__caption">
        Sıralama: platform listelerinde kalınan toplam ülke-hafta (izlenme sayıları yayımlanmıyor).
      </p>
      {data.monthly.length > 1 && (
        <>
          <p className="report__caption">Ay ay listelere giren farklı dizi sayısı</p>
          <MonthBars rows={data.monthly} valueKey="series" unit="dizi" />
        </>
      )}
    </>
  )
}

export function ContinentCountriesSection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.total} ülkenin {data.listed} tanesinde Türk dizisi listelere girdi.
      </p>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Ülke</th>
            <th scope="col">Listeye giren dizi</th>
            <th scope="col">Dizi-hafta</th>
            <th scope="col">İzlenme düzeyi</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 25).map((r) => (
            <tr key={r.iso2}>
              <td>
                <span className="report__country">
                  <Flag iso2={r.iso2} /> {nameOf(r.iso2)}
                </span>
              </td>
              <td>{r.series || '—'}</td>
              <td>{r.seriesWeeks || '—'}</td>
              <td>{r.watchLevel ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export const YEAR_SECTION_COMPONENTS = {
  contSeries: ContinentSeriesSection,
  contCountries: ContinentCountriesSection,
  yearLists: YearListsSection,
  yearTv: YearTvSection,
  yearReading: YearReadingSection,
  yearWatch: YearWatchSection,
  yearPress: YearPressSection,
  yearTourism: YearTourismSection,
  yearStudents: YearStudentsSection,
  yearMarkets: YearMarketsSection,
  yearSearch: YearSearchSection,
}
