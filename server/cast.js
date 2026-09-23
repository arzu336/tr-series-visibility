import { getRawSeriesDataCached, getEnrichedVisibility } from './data-pipeline.js'

function round1(n) {
  return Math.round(n * 10) / 10
}

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
