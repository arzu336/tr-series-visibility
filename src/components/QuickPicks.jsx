import Flag from './Flag.jsx'
import { WATCH_LEVEL_COLORS } from '../lib/scale.js'
import countryNames from '../data/country-centroids.json'
import { groupByContinent } from '../lib/continents.js'

// Arama yapılmadan önce boş kalan ekranlar (Raporlar, Arama İlgisi) için hızlı seçim kartları. Veri haritanın
// zaten yüklediği ülke listesinden gelir; ek istek yapılmaz.

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'

/** İzlenme endeksi en yüksek ülkeler (endeksi olmayanlar yayındaki dizi sayısına göre sona). */
export function topCountries(countries, n = 12) {
  return [...(countries || [])]
    .filter((c) => c.iso2 && c.iso2 !== 'TR')
    .sort(
      (a, b) =>
        (b.watchSignal?.index ?? -1) - (a.watchSignal?.index ?? -1) || (b.seriesCount || 0) - (a.seriesCount || 0)
    )
    .slice(0, n)
}

/**
 * Öne çıkan diziler: önce kaç ülkede o ülkenin en popüler Türk dizisi olduğu, eşitlikte popülerlik. Yayında olduğu
 * ülke sayısı tek başına ayırt etmiyor (küresel platformdaki dizilerin hepsi ~130 ülkede yayında).
 */
export function topSeries(countries, n = 12) {
  const byId = new Map()
  for (const c of countries || []) {
    for (const s of c.seriesList || []) {
      const e = byId.get(s.id) || {
        id: s.id,
        name: s.name,
        posterPath: s.posterPath,
        popularity: 0,
        countries: 0,
        top: 0,
      }
      e.countries++
      e.popularity = Math.max(e.popularity, s.popularity || 0)
      if (!e.posterPath && s.posterPath) e.posterPath = s.posterPath
      byId.set(s.id, e)
    }
    const t = c.topSeries && byId.get(c.topSeries.id)
    if (t) t.top++
  }
  return [...byId.values()].sort((a, b) => b.top - a.top || b.popularity - a.popularity).slice(0, n)
}

export function CountryQuickPicks({ countries, onPick, title = 'İzlenmesi en yüksek ülkeler' }) {
  const list = topCountries(countries)
  if (!list.length) return null
  return (
    <section className="quick-picks" aria-label={title}>
      <h3 className="quick-picks__title">{title}</h3>
      <div className="quick-picks__grid quick-picks__grid--countries">
        {list.map((c) => {
          const level = c.watchSignal?.level
          return (
            <button
              key={c.iso2}
              type="button"
              className="quick-pick quick-pick--country"
              onClick={() => onPick(c.iso2)}
            >
              <span className="quick-pick__name">
                <Flag iso2={c.iso2} />
                {countryNames[c.iso2]?.name || c.name || c.iso2}
              </span>
              <span className="quick-pick__meta">
                {level && (
                  <span className="quick-pick__level">
                    <span className="quick-pick__dot" style={{ background: WATCH_LEVEL_COLORS[level] }} />
                    {level}
                  </span>
                )}
                {c.seriesCount > 0 && <span>{c.seriesCount} dizi yayında</span>}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function SeriesQuickPicks({ countries, onPick, title = 'Öne çıkan diziler' }) {
  const list = topSeries(countries)
  if (!list.length) return null
  return (
    <section className="quick-picks" aria-label={title}>
      <h3 className="quick-picks__title">{title}</h3>
      <div className="quick-picks__grid quick-picks__grid--series">
        {list.map((s) => (
          <button key={s.id} type="button" className="quick-pick quick-pick--series" onClick={() => onPick(s.id)}>
            {s.posterPath ? (
              <img className="quick-pick__poster" src={`${POSTER_BASE}${s.posterPath}`} alt="" loading="lazy" />
            ) : (
              <span className="quick-pick__poster" aria-hidden="true" />
            )}
            <span className="quick-pick__name">{s.name}</span>
            <span className="quick-pick__meta">
              {s.top > 0 ? `${s.top} ülkede en popüler` : `${s.countries} ülkede yayında`}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Bütün ülkeler kıtalara göre (Türkiye hariç). */
export function AllCountries({ onPick, title = 'Bütün ülkeler' }) {
  const all = Object.keys(countryNames)
    .filter((iso2) => iso2 !== 'TR')
    .map((iso2) => ({ iso2, score: 0 }))
  // Kıtası olmayan kayıtlar (Antarktika, Fransız Güney Toprakları) ülke değil; listeye girmez.
  const groups = groupByContinent(all).filter((g) => g.countryCount > 0)
  const count = groups.reduce((n, g) => n + g.countryCount, 0)
  const byName = (a, b) => countryNames[a.iso2].name.localeCompare(countryNames[b.iso2].name, 'tr')
  return (
    <section className="quick-picks" aria-label={title}>
      <h3 className="quick-picks__title">
        {title}
        <span className="series-page__count"> · {count} ülke</span>
      </h3>
      <div className="quick-picks__continents">
        {groups.map((g) => (
          <div key={g.id} className="quick-picks__continent">
            <h4>{g.name}</h4>
            <ul>
              {[...g.countries].sort(byName).map((c) => (
                <li key={c.iso2}>
                  <button type="button" onClick={() => onPick(c.iso2)}>
                    <Flag iso2={c.iso2} />
                    {countryNames[c.iso2].name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
