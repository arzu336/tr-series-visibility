import db from './db.js'
import { getCacheInfo } from './cache.js'
import { getClassificationHealth } from './themes.js'
import { META_KEY as SCHEDULER_META_KEY } from './scheduler.js'

const SNAPSHOT_KEY = 'lastSnapshotAt'
const SCHEDULER_FRESH_WINDOW_MS = 26 * 3_600_000 // hedef 24 saat + 30dk'lık kontrol payı

function sourceStatus({ isFresh, hasData }) {
  if (!hasData) return 'veri-bekleniyor'
  return isFresh ? 'güncel' : 'yenileme-gerekli'
}

function toEpochMs(isoOrNull) {
  return isoOrNull ? new Date(isoOrNull).getTime() : null
}

function freshnessHoursOf(epochMs, now) {
  return epochMs ? Math.round(((now - epochMs) / 3_600_000) * 10) / 10 : null
}

// SerpAPI/Trakt talep-üzerine (kullanıcı bir diziyi sorguladığında) ve süresiz
// cache'lenen kaynaklar — TMDB'nin aksine sabit bir TTL/"bayatlama" kavramları
// yok, bu yüzden "güncel mi" değil "hiç veri var mı" ve "en son ne zaman
// sorgulandı" soruluyor. Hata oranı henüz kalıcı olarak tutulmadığı için
// (bkz. classification_failures'ın aksine) burada uydurulmuyor.
function onDemandCacheStats(table) {
  const row = db.prepare(`SELECT COUNT(*) AS n, MAX(queried_at) AS last FROM ${table}`).get()
  return { count: row.n || 0, lastQueriedAt: row.last || null }
}

export function getSourceHealth(rawSeries) {
  const now = Date.now()
  const tmdb = getCacheInfo('raw-series-providers')
  const classification = getClassificationHealth(rawSeries)
  const snapshot = db.prepare('SELECT value FROM meta WHERE key = ?').get(SNAPSHOT_KEY)
  const lastSnapshotAt = snapshot ? Number(snapshot.value) : null

  const trends = onDemandCacheStats('trends_cache')
  const social = onDemandCacheStats('social_listening_cache')
  const serpapiCount = trends.count + social.count
  const serpapiLastAt = [trends.lastQueriedAt, social.lastQueriedAt].filter(Boolean).sort().at(-1) || null

  const trakt = onDemandCacheStats('trakt_cache')

  const schedulerRow = db.prepare('SELECT value FROM meta WHERE key = ?').get(SCHEDULER_META_KEY)
  const lastScheduledAt = schedulerRow ? Number(schedulerRow.value) : null

  return {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        id: 'tmdb',
        name: 'TMDB + platform erişimi',
        status: sourceStatus({ isFresh: tmdb?.isFresh, hasData: Boolean(tmdb) }),
        lastSuccessAt: tmdb?.updatedAt || null,
        freshnessHours: tmdb?.updatedAt ? Math.round(((now - tmdb.updatedAt) / 3_600_000) * 10) / 10 : null,
        detail: tmdb ? `${rawSeries.length} dizi için platform erişimi` : 'İlk veri çekimi bekleniyor',
      },
      {
        id: 'llm',
        name: 'Tema sınıflandırması',
        status: classification.pending === 0 ? 'güncel' : classification.delayedRetries > 0 ? 'yeniden-denenecek' : 'işleniyor',
        lastSuccessAt: null,
        detail: `${classification.classified}/${classification.total} dizi sınıflandırıldı`,
        ...classification,
      },
      {
        id: 'history',
        name: 'Görünürlük trend geçmişi',
        status: sourceStatus({ isFresh: lastSnapshotAt && now - lastSnapshotAt < 24 * 3_600_000, hasData: Boolean(lastSnapshotAt) }),
        lastSuccessAt: lastSnapshotAt || null,
        freshnessHours: lastSnapshotAt ? Math.round(((now - lastSnapshotAt) / 3_600_000) * 10) / 10 : null,
        detail: lastSnapshotAt ? 'Ülke bazlı değişim takibi aktif' : 'İlk trend anlık görüntüsü bekleniyor',
      },
      {
        id: 'serpapi',
        name: 'SerpAPI (Arama İlgisi + Sosyal Dinleme)',
        status: serpapiCount > 0 ? 'güncel' : 'veri-bekleniyor',
        lastSuccessAt: serpapiLastAt,
        freshnessHours: freshnessHoursOf(toEpochMs(serpapiLastAt), now),
        detail: `${serpapiCount} sorgu cache'lendi (${rawSeries.length} dizilik havuzdan, talep üzerine)`,
      },
      {
        id: 'trakt',
        name: 'Trakt.tv',
        status: trakt.count > 0 ? 'güncel' : 'veri-bekleniyor',
        lastSuccessAt: trakt.lastQueriedAt,
        freshnessHours: freshnessHoursOf(toEpochMs(trakt.lastQueriedAt), now),
        detail: `${trakt.count} dizi sorgulandı (${rawSeries.length} dizilik havuzdan, talep üzerine)`,
      },
      {
        id: 'scheduler',
        name: 'Otomatik Günlük Tazeleme',
        status: sourceStatus({ isFresh: lastScheduledAt && now - lastScheduledAt < SCHEDULER_FRESH_WINDOW_MS, hasData: Boolean(lastScheduledAt) }),
        lastSuccessAt: lastScheduledAt,
        freshnessHours: freshnessHoursOf(lastScheduledAt, now),
        detail: lastScheduledAt
          ? 'TMDB + tema sınıflandırma + trend geçmişi otomatik tazeleniyor (n8n yerine kod-içi zamanlayıcı)'
          : 'İlk otomatik tazeleme bekleniyor (sunucu başladıktan en geç 30 dk sonra)',
      },
    ],
  }
}
