import express from 'express'
import { buildDestinationRanking } from '../aggregate.js'
import { getEnrichedVisibility } from '../data-pipeline.js'
import { buildImpactReport, buildCulturalImpact, buildTourismImpact, buildExportImpact } from '../impact.js'
import { buildCountryConvergence } from '../services/countrySummary.js'
import { sanitizeClaimsPayload } from '../services/claimsGate.js'
import { generateCountryDataSummary } from '../llm.js'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import { requireAdmin } from './auth.js'
import { upstream } from './shared.js'

// Etki & ihracat analizi — yalnızca yönetici (arayüzde de yalnızca yönetici sekmesi).
export const impactRouter = express.Router()

impactRouter.use('/api/impact', requireAdmin)

async function visibilityWithDestinations() {
  const { data, raw, destinationStore } = await getEnrichedVisibility()
  return { data, destinationRanking: buildDestinationRanking(data.countries, raw.series, destinationStore) }
}

impactRouter.get(
  '/api/impact',
  upstream('impact', async (req, res) => {
    const { data, destinationRanking } = await visibilityWithDestinations()
    res.json(await buildImpactReport(data.countries, destinationRanking))
  })
)

impactRouter.get(
  '/api/impact/cultural',
  upstream('impact/cultural', (req, res) => {
    res.json(buildCulturalImpact())
  })
)

impactRouter.get(
  '/api/impact/tourism',
  upstream('impact/tourism', async (req, res) => {
    const { data, destinationRanking } = await visibilityWithDestinations()
    res.json(await buildTourismImpact(data.countries, destinationRanking))
  })
)

impactRouter.get(
  '/api/impact/export',
  upstream('impact/export', async (req, res) => {
    const { data } = await getEnrichedVisibility()
    res.json(await buildExportImpact(data.countries))
  })
)

impactRouter.get(
  '/api/impact/country-summary/:iso2',
  upstream('impact/country-summary', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const iso2 = normalizeIso2(req.params.iso2)
    const { data } = await getEnrichedVisibility()
    const convergence = await buildCountryConvergence(iso2, data.countries)

    const { removed } = sanitizeClaimsPayload(convergence)
    if (removed > 0) {
      console.log(`[impact/country-summary] ${iso2}: ${removed} doğrulanmamış iddia elendi`)
    }

    if (req.query.insight !== '1') return res.json(convergence)

    let llmSummary = null
    let llmError = null
    try {
      llmSummary = await generateCountryDataSummary(convergence)
    } catch (err) {
      console.error(`[impact/country-summary] ${iso2} LLM özeti üretilemedi:`, err.message)
      llmError = err.message
    }
    res.json({ ...convergence, llmSummary, llmError })
  })
)
