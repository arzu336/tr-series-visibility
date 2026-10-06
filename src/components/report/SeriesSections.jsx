import countryNames from '../../data/country-centroids.json'
import Flag from '../Flag.jsx'
import EpisodeHeatmap from '../EpisodeHeatmap.jsx'
import { TrendBadge } from '../ChartList.jsx'
import { fmtNum } from './format.js'

// Dizi raporu bölümleri (sözleşme dizi-raporu-v1). Yalnızca sunucudan gelen `data`yı basar.

const nameOf = (iso2) => countryNames[iso2]?.name || iso2

function Country({ iso2 }) {
  return (
    <span className="report__country">
      <Flag iso2={iso2} /> {nameOf(iso2)}
    </span>
  )
}

const TONE = { olumlu: 'Olumlu', olumsuz: 'Olumsuz', nötr: 'Nötr', karisik: 'Karışık', karışık: 'Karışık' }

export function SeriesMarketsSection({ data }) {
  return (
    <>
      <dl className="report__kpis">
        <div className="report__kpi">
          <dt>Bu hafta sıralamada</dt>
          <dd>{data.countriesNow} ülke</dd>
        </div>
        <div className="report__kpi">
          <dt>Son 52 haftada sıralamaya girdiği</dt>
          <dd>{data.countries52} ülke</dd>
        </div>
      </dl>
      <table className="dashboard__table dashboard__table--compact report__table">
        <thead>
          <tr>
            <th scope="col">Ülke</th>
            <th scope="col">Bu hafta</th>
            <th scope="col">Değişim</th>
            <th scope="col">Listede</th>
            <th scope="col">En iyi sıra</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 25).map((r) => (
            <tr key={r.iso2}>
              <td>
                <Country iso2={r.iso2} />
              </td>
              <td>{r.position != null ? `${r.position}.` : '—'}</td>
              <td>
                <TrendBadge trend={r.trend} withCount />
              </td>
              <td>{r.weeks} hafta</td>
              <td>{r.bestPosition}.</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function SeriesOpportunitySection({ data }) {
  const shared = data.shared || []
  return (
    <>
      <p className="report__lead">
        {data.total} ülkede dizinin okunduğu dil konuşuluyor ama dizi orada izlenebilir bir platformda ya da sıralamada
        görünmüyor.
      </p>
      {data.rows.length > 0 && (
        <table className="dashboard__table dashboard__table--compact report__table">
          <thead>
            <tr>
              <th scope="col">Ülke</th>
              <th scope="col">Dil</th>
              <th scope="col">Okunma (12 ay)</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.iso2}>
                <td>
                  <Country iso2={r.iso2} />
                </td>
                <td>{r.languageName}</td>
                <td>{fmtNum(r.views, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shared.length > 0 && (
        <>
          <p className="report__caption">Ortak dillerde (okunma bu ülkelere ayrılamaz)</p>
          <ul className="report__platforms">
            {shared.map((s) => (
              <li key={s.lang}>
                <strong>{s.languageName}</strong>{' '}
                <span className="report__basis">
                  {fmtNum(s.views, 0)} okunma · {s.countries.length} ülke
                </span>
                <span className="report__flags">
                  {s.countries.map((iso2) => (
                    <Flag key={iso2} iso2={iso2} title={nameOf(iso2)} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

export function SeriesAvailabilitySection({ data }) {
  return (
    <>
      <p className="report__lead">
        {data.countryCount} ülkede izlenebiliyor
        {data.platforms.length ? `; ${data.platforms.length} platform kaydı var` : ''}.
      </p>
      <ul className="report__platforms">
        {data.platforms.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong> <span className="report__basis">{p.countries.length} ülke</span>
            <span className="report__flags">
              {p.countries.map((iso2) => (
                <Flag key={iso2} iso2={iso2} title={nameOf(iso2)} />
              ))}
            </span>
          </li>
        ))}
        {data.listedOnly?.length > 0 && (
          <li>
            <strong>Sıralamaya girdiği diğer ülkeler</strong>{' '}
            <span className="report__basis">{data.listedOnly.length} ülke</span>
            <span className="report__flags">
              {data.listedOnly.map((iso2) => (
                <Flag key={iso2} iso2={iso2} title={nameOf(iso2)} />
              ))}
            </span>
          </li>
        )}
      </ul>
    </>
  )
}

export function SeriesImdbSection({ data }) {
  return (
    <>
      {data.rating != null && (
        <dl className="report__kpis">
          <div className="report__kpi">
            <dt>İzleyici puanı</dt>
            <dd>{fmtNum(data.rating, 1)}</dd>
            <small>{fmtNum(data.votes, 0)} oy</small>
          </div>
          {data.growth7?.votes > 0 && (
            <div className="report__kpi">
              <dt>Son {data.growth7.days} günde</dt>
              <dd>+{fmtNum(data.growth7.votes, 0)}</dd>
              <small>yeni oy</small>
            </div>
          )}
        </dl>
      )}
      {data.seasons?.length > 0 && <EpisodeHeatmap seasons={data.seasons} />}
    </>
  )
}

export function SeriesPressSection({ data }) {
  return (
    <table className="dashboard__table dashboard__table--compact report__table">
      <thead>
        <tr>
          <th scope="col">Ülke</th>
          <th scope="col">Ton</th>
          <th scope="col">Haber</th>
        </tr>
      </thead>
      <tbody>
        {data.items.map((i) => (
          <tr key={i.iso2}>
            <td>
              <Country iso2={i.iso2} />
            </td>
            <td>{TONE[i.tone] ?? i.tone}</td>
            <td>{i.newsCount ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SeriesContentSection({ data }) {
  return (
    <dl className="report__facts">
      {data.theme && (
        <>
          <dt>Tema</dt>
          <dd>{data.theme}</dd>
        </>
      )}
      {data.destinations.length > 0 && (
        <>
          <dt>Anlatıda geçen yerler</dt>
          <dd>{data.destinations.map((d) => d.charAt(0).toLocaleUpperCase('tr') + d.slice(1)).join(', ')}</dd>
        </>
      )}
      {data.directors.length > 0 && (
        <>
          <dt>Yönetmen</dt>
          <dd>{data.directors.join(', ')}</dd>
        </>
      )}
      {data.writers.length > 0 && (
        <>
          <dt>Senaryo</dt>
          <dd>{data.writers.join(', ')}</dd>
        </>
      )}
      {data.akas.length > 0 && (
        <>
          <dt>Uluslararası adları</dt>
          <dd>
            <ul className="report__akas">
              {data.akas.map((a) => (
                <li key={a.title}>
                  {a.title}{' '}
                  <span className="report__flags">
                    {a.regions.map((r) => (
                      <Flag key={r} iso2={r} title={nameOf(r)} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </dl>
  )
}

export const SERIES_SECTION_COMPONENTS = {
  seriesMarkets: SeriesMarketsSection,
  seriesOpportunity: SeriesOpportunitySection,
  seriesAvailability: SeriesAvailabilitySection,
  seriesImdb: SeriesImdbSection,
  seriesPress: SeriesPressSection,
  seriesContent: SeriesContentSection,
}
