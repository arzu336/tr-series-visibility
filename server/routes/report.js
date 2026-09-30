import express from 'express'
import { isValidIso2, normalizeIso2 } from '../services/requestGuards.js'
import {
  buildCountryReport,
  selectProfile,
  PROFILES,
  PROFILE_MIN_ACCESS,
  PROFILE_TITLES,
} from '../services/countryReport.js'
import { sanitizeReportPayload } from '../services/claimsGate.js'
import { direktifIceriyorMu } from '../llm.js'
import { hasAccessLevel } from './auth.js'
import { upstream } from './shared.js'

// Ülke raporu: tek veri kaynağı (buildCountryReport), üç profil (yalnızca bölüm seçimi), profil
// bazlı yetki: executive → viewer+, marketing → analyst+, producer → admin.
export const reportRouter = express.Router()

function allowedProfilesFor(user) {
  return Object.keys(PROFILES).filter((p) => hasAccessLevel(user, PROFILE_MIN_ACCESS[p]))
}

reportRouter.get('/api/report/profiles', (req, res) => {
  res.json({
    profiles: Object.keys(PROFILES).map((p) => ({
      id: p,
      title: PROFILE_TITLES[p],
      minAccess: PROFILE_MIN_ACCESS[p],
      allowed: hasAccessLevel(req.currentUser, PROFILE_MIN_ACCESS[p]),
    })),
  })
})

reportRouter.get(
  '/api/report/country/:iso2',
  upstream('report/country', async (req, res) => {
    if (!isValidIso2(req.params.iso2)) return res.status(400).json({ error: 'Geçersiz ülke kodu' })
    const profile = String(req.query.profile || 'executive')
    if (!PROFILES[profile]) {
      return res.status(400).json({ error: `Bilinmeyen profil: ${profile}`, profiles: Object.keys(PROFILES) })
    }
    const minAccess = PROFILE_MIN_ACCESS[profile]
    if (!hasAccessLevel(req.currentUser, minAccess)) {
      return res
        .status(403)
        .json({ error: `"${PROFILE_TITLES[profile]}" için en az ${minAccess} erişim düzeyi gerekir` })
    }

    const iso2 = normalizeIso2(req.params.iso2)
    const report = await buildCountryReport(iso2, { useCache: req.query.fresh !== '1' })
    const selected = selectProfile(report, profile)
    const { removedClaims, removedDirectives } = sanitizeReportPayload(selected, { direktifIceriyorMu })
    if (removedClaims || removedDirectives) {
      console.log(
        `[report] ${iso2}/${profile}: ${removedClaims} doğrulanmamış iddia, ${removedDirectives} direktif elendi`
      )
    }
    res.json({ ...selected, availableProfiles: allowedProfilesFor(req.currentUser) })
  })
)
