import { getRawSeriesDataCached, getEnrichedVisibility } from './data-pipeline.js'

function round1(n) {
  return Math.round(n * 10) / 10
}

// Bir oyuncunun (TMDB person id) zaten takip ettiğimiz 200 dizi içinde oynadığı diğer
// Türk dizilerini ve bu dizilerin ülke bazlı görünürlük dağılımını bulur. Ayrı bir TMDB
// isteği (ör. /person/{id}/tv_credits) gerekmez — kadro verisi zaten data-pipeline.js'in
// 24 saatlik cache'inde (server/tmdb.js getCredits) hazır, burada sadece taranır.
export async function buildPersonImpact(personId) {
  const id = Number(personId)
  const raw = await getRawSeriesDataCached()

  const appearances = raw.series
    .map((show) => ({ show, castEntry: (show.cast || []).find((c) => c.id === id) }))
    .filter((entry) => entry.castEntry)

  if (appearances.length === 0) {
    return { status: 'unavailable' }
  }

  const { data } = await getEnrichedVisibility()

  const series = appearances
    .map(({ show, castEntry }) => {
      const countries = data.countries
        .filter((c) => c.seriesList.some((s) => s.id === show.id))
        .map((c) => ({ iso2: c.iso2, score: round1(c.score) }))
        .sort((a, b) => b.score - a.score)
      const totalScore = round1(countries.reduce((sum, c) => sum + c.score, 0))
      return {
        id: show.id,
        name: show.name,
        character: castEntry.character,
        posterPath: show.posterPath || null,
        totalScore,
        countries,
      }
    })
    .sort((a, b) => b.totalScore - a.totalScore)

  // TMDB kadro girdilerinden bazılarında profilePath eksik olabiliyor — sadece ilk
  // görünüme (appearances[0]) bakmak, o dizideki kaydı boşsa oyuncunun BAŞKA bir
  // dizide gerçekten var olan fotoğrafını da göz ardı edip görseli hiç göstermiyordu.
  // Fotoğrafı olan İLK kaydı kullanmak bu veri kaybını önlüyor.
  const personSource = appearances.find((a) => a.castEntry.profilePath) || appearances[0]
  return {
    status: 'ready',
    person: {
      id,
      name: personSource.castEntry.name,
      profilePath: personSource.castEntry.profilePath,
    },
    series,
  }
}
