import continentByIso2 from '../data/continents.json'
import countryNames from '../data/country-centroids.json'

const ISO2_BY_NAME = new Map(
  Object.entries(countryNames).map(([iso2, entry]) => [entry.name.toLocaleLowerCase('tr'), iso2])
)

// SerpAPI/Google Trends bölge etiketleri bazen ISO2 kod, bazen (hl parametresine göre)
// yerelleştirilmiş ülke adı olarak dönüyor (bkz. server/turkish-learning-interest.js) —
// her iki biçimi de country-centroids.json'daki gerçek iso2 koduna eşlemeye çalışır,
// eşleşme yoksa null döner (uydurma bir eşleşme yapılmaz).
export function resolveIso2FromLabel(label) {
  if (!label) return null
  const trimmed = String(label).trim()
  if (trimmed.length === 2 && countryNames[trimmed.toUpperCase()]) {
    return trimmed.toUpperCase()
  }
  return ISO2_BY_NAME.get(trimmed.toLocaleLowerCase('tr')) || null
}

// Sırayla gösterim için — Lowy Institute tarzı kıta filtresiyle aynı mantık:
// sabit, öngörülebilir bir sırayla listelenir.
export const CONTINENTS = [
  { id: 'europe', name: 'Avrupa' },
  { id: 'middle_east', name: 'Orta Doğu' },
  { id: 'latin_america', name: 'Latin Amerika' },
  { id: 'asia_pacific', name: 'Asya-Pasifik' },
  { id: 'africa', name: 'Afrika' },
  { id: 'north_america', name: 'Kuzey Amerika' },
]

const CONTINENT_NAME_BY_ID = Object.fromEntries(CONTINENTS.map((c) => [c.id, c.name]))

export function continentName(id) {
  return CONTINENT_NAME_BY_ID[id] || id
}

// countries: /api/visibility'den gelen gerçek ülke listesi (score, seriesCount, topSeries vb.).
// Her kıta için: en yüksek skorlu ülke ve kıtadaki toplam/ortalama skor (gerçek TMDB popülerlik
// verisine dayalı bir proxy — resmi izlenme/ihracat rakamı değil, bkz. ImpactReport'taki aynı uyarı).
export function groupByContinent(countries) {
  const byContinent = new Map(CONTINENTS.map((c) => [c.id, { ...c, countries: [] }]))

  for (const country of countries || []) {
    const continentId = continentByIso2[country.iso2]
    if (!continentId || !byContinent.has(continentId)) continue
    byContinent.get(continentId).countries.push(country)
  }

  return CONTINENTS.map((c) => {
    const bucket = byContinent.get(c.id)
    const sorted = [...bucket.countries].sort((a, b) => b.score - a.score)
    const totalScore = sorted.reduce((sum, country) => sum + country.score, 0)
    return {
      id: c.id,
      name: c.name,
      countries: sorted,
      countryCount: sorted.length,
      topCountry: sorted[0] || null,
      topCountries: sorted.slice(0, 5),
      totalScore,
      averageScore: sorted.length > 0 ? totalScore / sorted.length : 0,
    }
  })
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

const MIN_CONTINENT_ALTITUDE = 1.8
const MAX_CONTINENT_ALTITUDE = 3.4
const MIN_CONTINENT_SCALE = 1.15
const MAX_CONTINENT_SCALE = 2.0

// Kıta odaklanması (flyTo) için: üye ülkelerin gerçek merkez koordinatlarının (bkz.
// country-centroids.json) ortalaması — uydurma/sabit bir kıta merkezi değil, elimizdeki
// ülke listesine göre hesaplanan gerçek bir ağırlık merkezi. Yakınlaşma mesafesi de sabit
// değil: kıtanın gerçek yayılımına (centroid'e olan en uzak ülkenin mesafesi) göre
// hesaplanır — dar bir kıta (ör. Orta Doğu) aşırı yakınlaşmaz, geniş bir kıta (ör.
// Asya-Pasifik) aşırı uzaklaşmaz; ikisi de rahatça "sınırların görülebildiği" bir çerçevede
// kalır (fitBounds'un elle yapılan karşılığı — globe.gl'de native bir fitBounds yok).
export function continentCentroid(countryList) {
  const points = (countryList || [])
    .map((c) => countryNames[c.iso2])
    .filter(Boolean)
  if (points.length === 0) return null

  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length
  const maxSpread = Math.max(...points.map((p) => Math.hypot(p.lat - lat, p.lng - lng)))

  const altitude = clamp(1.8 + maxSpread / 30, MIN_CONTINENT_ALTITUDE, MAX_CONTINENT_ALTITUDE)
  const scale = clamp(2.0 - maxSpread / 55, MIN_CONTINENT_SCALE, MAX_CONTINENT_SCALE)

  return { lat, lng, altitude, scale }
}

// Sol panelin sadeleştirilmiş "En Çok İzlenen Dizi" kartı için — kıtadaki tüm ülkelerin
// seriesList'lerinden (zaten /api/visibility'de var) aynı dizinin göründüğü her ülkedeki
// popülerliğini toplayıp en yükseği döner. Gerçek veriden hesaplanır, uydurma değil.
export function topSeriesInContinent(countryList) {
  const totals = new Map()
  for (const country of countryList || []) {
    for (const series of country.seriesList || []) {
      const prev = totals.get(series.id)
      if (prev) {
        prev.totalPopularity += series.popularity
        prev.countryCount += 1
      } else {
        totals.set(series.id, { id: series.id, name: series.name, totalPopularity: series.popularity, countryCount: 1 })
      }
    }
  }
  let top = null
  for (const entry of totals.values()) {
    if (!top || entry.totalPopularity > top.totalPopularity) top = entry
  }
  return top
}
