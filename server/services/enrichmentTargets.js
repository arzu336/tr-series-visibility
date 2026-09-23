import { getEnrichedVisibility } from '../data-pipeline.js'

export const TOP_SERIES_COUNT = 35
export const TOP_COUNTRY_COUNT = 25
export const TOP_ACTOR_COUNT = 30

const CURATED_DIVERSITY_ISO2 = [
  'AR', 'PE', 'BO',
  'SA', 'EG', 'MA',
  'UA', 'RS', 'BA',
  'KZ', 'UZ', 'TM',
]

function buildCountryPool(countries, targetCount) {
  const byScore = [...countries].filter((c) => c.dataSource !== 'proxy').sort((a, b) => b.score - a.score)
  const byIso2 = new Map(byScore.map((c) => [c.iso2, c]))
  const curated = CURATED_DIVERSITY_ISO2.map((iso2) => byIso2.get(iso2)).filter(Boolean)
  const curatedSet = new Set(curated.map((c) => c.iso2))
  const naturalSlots = Math.max(0, targetCount - curated.length)
  const natural = byScore.filter((c) => !curatedSet.has(c.iso2)).slice(0, naturalSlots)
  return [...natural, ...curated]
}

export async function getEnrichmentTargets() {
  const { data, raw } = await getEnrichedVisibility()

  const topSeries = [...raw.series]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, TOP_SERIES_COUNT)
    .map((s) => ({ id: s.id, name: s.name }))

  const topCountries = buildCountryPool(data.countries, TOP_COUNTRY_COUNT).map((c) => c.iso2)

  return { topSeries, topCountries }
}

export async function getTopActors(n = TOP_ACTOR_COUNT) {
  const { raw } = await getEnrichedVisibility()
  const byActor = new Map()
  for (const s of raw.series) {
    for (const actor of s.cast || []) {
      const existing = byActor.get(actor.id)
      if (existing) {
        existing.popularitySum += s.popularity
        existing.seriesCount += 1
      } else {
        byActor.set(actor.id, { id: actor.id, name: actor.name, profilePath: actor.profilePath, popularitySum: s.popularity, seriesCount: 1 })
      }
    }
  }
  return [...byActor.values()].sort((a, b) => b.popularitySum - a.popularitySum).slice(0, n)
}
