import db from '../db.js'
import { getEnrichmentTargets, getTopActors } from './enrichmentTargets.js'
import { cacheFirstSerpApi, fetchTrendsByCountryRaw, actorTrendsCacheKey, TRENDS_TTL_MS, getSerpApiUsageThisMonth } from './serpApiCache.js'
import { resolveIso2FromLabel } from './countryLookup.js'

// "En popüler 30 Türk oyuncusunun hedef ülkelerdeki Google Trends ilgisi" — kullanıcı talebi.
// VERİMLİLİK: series-adı Trends sorgusuyla AYNI mekanizma (fetchTrendsByCountryRaw, data_type=
// GEO_MAP_0, geo parametresi VERİLMEDEN) kullanılıyor — bu TEK bir çağrıda oyuncunun TÜM
// ülkelerdeki ilgisini birden döner. Yani maliyet 30 oyuncu × hedef ülke sayısı DEĞİL, sadece 30
// gerçek SerpAPI çağrısı (oyuncu başına 1) — bkz. enrichmentTargets.js'teki kapasite notu.
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000
const META_KEY = 'lastActorTrendsCollectAt'
const DELAY_AFTER_LIVE_CALL_MS = 1500

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')
const setMetaStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)
const upsertStmt = db.prepare(`
  INSERT INTO actor_country_interest (actor_id, actor_name, country_iso2, interest_value, computed_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(actor_id, country_iso2) DO UPDATE SET
    actor_name = excluded.actor_name,
    interest_value = excluded.interest_value,
    computed_at = excluded.computed_at,
    expires_at = excluded.expires_at
`)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runActorTrendsCollectionIfNeeded() {
  const row = getMetaStmt.get(META_KEY)
  const lastRunAt = row ? Number(row.value) : 0
  if (Date.now() - lastRunAt < WEEKLY_MS) return

  console.log('[actorTrendsCollector] haftalık oyuncu arama ilgisi taraması başladı')
  let scanned = 0
  let liveCalls = 0
  let failed = 0

  try {
    const [actors, { topCountries }] = await Promise.all([getTopActors(), getEnrichmentTargets()])
    const targetIso2Set = new Set(topCountries)
    const nowIso = new Date().toISOString()

    for (const actor of actors) {
      const usage = getSerpApiUsageThisMonth()
      if (usage.used >= usage.budget) {
        console.warn(`[actorTrendsCollector] aylık SerpAPI kotası doldu (${usage.used}/${usage.budget}) — kalan oyuncular bir sonraki döngüye bırakıldı.`)
        break
      }
      try {
        const key = actorTrendsCacheKey(actor.name)
        const result = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(actor.name))
        scanned++
        // Ham yanıt (result.byCountry) dünya genelinde onlarca ülke içerebilir — sadece platformun
        // ZATEN takip ettiği hedef havuzla (getEnrichmentTargets) kesişenler kalıcı tabloya yazılır,
        // uydurma/ilgisiz bir ülke listesi genişletilmez.
        for (const entry of result.byCountry) {
          const iso2 = resolveIso2FromLabel(entry.country)
          if (!iso2 || !targetIso2Set.has(iso2)) continue
          upsertStmt.run(actor.id, actor.name, iso2, entry.value, nowIso, Date.now() + TRENDS_TTL_MS)
        }
        if (!result.fromCache) {
          liveCalls++
          await sleep(DELAY_AFTER_LIVE_CALL_MS)
        }
      } catch (err) {
        failed++
        console.error(`[actorTrendsCollector] ${actor.name} taranamadı:`, err.message)
      }
    }

    setMetaStmt.run(META_KEY, String(Date.now()))
    console.log(
      `[actorTrendsCollector] tarama tamamlandı — ${scanned} oyuncu tarandı (${liveCalls} canlı SerpAPI çağrısı, ${failed} hata).`
    )
  } catch (err) {
    console.error('[actorTrendsCollector] oyuncu trend taraması başarısız:', err.message)
  }
}

// Taranmış bir oyuncunun hedef ülkelerdeki güncel (süresi dolmamış) ilgi dağılımı.
const getInterestStmt = db.prepare(
  'SELECT country_iso2, interest_value, computed_at FROM actor_country_interest WHERE actor_id = ? AND expires_at > ? ORDER BY interest_value DESC'
)

export function getActorCountryInterest(actorId) {
  return getInterestStmt.all(actorId, Date.now()).map((r) => ({
    iso2: r.country_iso2,
    value: r.interest_value,
    computedAt: r.computed_at,
  }))
}
