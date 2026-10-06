import db from '../db.js'
import { getCached } from '../cache.js'
import { getEnglishTitles } from './localTitles.js'
import { buildTitleMatcher } from './youtubeAnalytics.js'
import { languageDistribution } from './commentLanguage.js'

// YouTube herkese açık veri (2026-10-06): yalnızca bir API anahtarıyla (YOUTUBE_API_KEY), kanal sahibinin izni
// gerekmeden. Resmî yayıncı kanallarının yüklediği videolar başlıktan dizilere eşlenir; her gün videoların
// izlenme / beğeni / yorum sayısı alınıp dizi başına toplanır (artış buradan hesaplanır). Haftada bir dizinin son
// bölümlerinden yorum örneklenir ve dil dağılımı çıkarılır. Ülke kırılımı YOKTUR — o yalnızca izinli Analytics'te.
//
// Kota: YouTube Data API günlük 10.000 birim; burada kullanılan her istek 1 birim. Günlük sınır
// YOUTUBE_DAILY_QUOTA (varsayılan 8000) ile korunur; dolunca iş ertesi güne kalır.

const DATA_API = 'https://www.googleapis.com/youtube/v3'

// Resmî yayıncı kanalları (YouTube kullanıcı adı). İlk çalıştırmada çözülür; bulunamayan ad yönetim ekranında
// hata olarak görünür. YOUTUBE_PUBLIC_CHANNELS (virgülle ayrılmış) ile değiştirilebilir.
export const DEFAULT_CHANNELS = ['@atvturkiye', '@showtv', '@startv', '@kanald', '@trt1', '@nowtv', '@tv8', '@kanal7']

const PAGES_PER_CHANNEL_RUN = 40 // kanal başına çalıştırma başına en çok 2.000 video; eskiler günlere yayılır
const COMMENT_VIDEOS = 5
const COMMENT_PER_VIDEO = 100
const COMMENT_EVERY_MS = 7 * 24 * 60 * 60 * 1000
const RUN_EVERY_MS = 24 * 60 * 60 * 1000

export function publicConfig(env = process.env) {
  const handles = (env.YOUTUBE_PUBLIC_CHANNELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    apiKey: env.YOUTUBE_API_KEY || null,
    ready: Boolean(env.YOUTUBE_API_KEY),
    handles: handles.length ? handles : DEFAULT_CHANNELS,
    dailyQuota: Number(env.YOUTUBE_DAILY_QUOTA) || 8000,
  }
}

// ---------------------------------------------------------------------------------------------- kota

const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?')
const metaSet = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
// YouTube kotası Pasifik saatiyle gece yarısı sıfırlanır; UTC günü yaklaşık bir sınırdır (güvenli tarafta kalır).
const quotaKey = (now) => `ytPublicQuota:${now.toISOString().slice(0, 10)}`

export function quotaUsedToday(now = new Date()) {
  return Number(metaGet.get(quotaKey(now))?.value || 0)
}

class QuotaExhausted extends Error {}

function makeClient({ cfg, fetchFn, now }) {
  let used = quotaUsedToday(now)
  return {
    get used() {
      return used
    },
    async get(path, params) {
      if (used >= cfg.dailyQuota) throw new QuotaExhausted('Günlük YouTube kotası doldu')
      const url = new URL(`${DATA_API}/${path}`)
      for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
      url.searchParams.set('key', cfg.apiKey)
      used++
      metaSet.run(quotaKey(now), String(used))
      const res = await fetchFn(url.toString())
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason = body?.error?.errors?.[0]?.reason
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')
          throw new QuotaExhausted('YouTube kotası doldu')
        throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { status: res.status, reason })
      }
      return body
    },
  }
}

// ---------------------------------------------------------------------------------------------- kayıt

const getChannel = db.prepare('SELECT * FROM yt_public_channels WHERE handle = ?')
const insertChannel = db.prepare('INSERT OR IGNORE INTO yt_public_channels (handle) VALUES (?)')
const updateChannel = db.prepare(`
  UPDATE yt_public_channels SET channel_id = ?, title = ?, uploads_playlist = ?, page_token = ?, backfill_done = ?,
    last_run_at = ?, last_error = ? WHERE handle = ?
`)
const hasVideo = db.prepare('SELECT 1 FROM yt_public_videos WHERE video_id = ?')
const upsertVideo = db.prepare(`
  INSERT INTO yt_public_videos (video_id, channel_id, title, published_at, series_id) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, series_id = excluded.series_id
`)
const setStats = db.prepare(
  'UPDATE yt_public_videos SET views = ?, likes = ?, comments = ?, stats_at = ? WHERE video_id = ?'
)
const upsertDaily = db.prepare(`
  INSERT INTO yt_series_daily (series_id, date, videos, views, likes, comments)
  SELECT series_id, ?, COUNT(*), COALESCE(SUM(views), 0), COALESCE(SUM(likes), 0), COALESCE(SUM(comments), 0)
  FROM yt_public_videos WHERE series_id IS NOT NULL AND views IS NOT NULL GROUP BY series_id
  ON CONFLICT(series_id, date) DO UPDATE SET videos = excluded.videos, views = excluded.views,
    likes = excluded.likes, comments = excluded.comments
`)

function catalogSeries() {
  return getCached('raw-series-providers')?.series || []
}

// ---------------------------------------------------------------------------------------------- adımlar

/** Kanal: kullanıcı adını kimliğe çözer, yeni videoları listeler (en yeniden; bilinen videoda durur). */
async function syncChannelVideos(handle, client, match, now) {
  insertChannel.run(handle)
  let ch = getChannel.get(handle)
  if (!ch.channel_id) {
    const body = await client.get('channels', { part: 'snippet,contentDetails', forHandle: handle })
    const it = body.items?.[0]
    if (!it) throw new Error(`${handle} adlı kanal bulunamadı`)
    ch = {
      ...ch,
      channel_id: it.id,
      title: it.snippet?.title || handle,
      uploads_playlist: it.contentDetails?.relatedPlaylists?.uploads || null,
    }
  }
  let pageToken = ch.backfill_done ? null : ch.page_token
  let done = false
  let added = 0
  for (let page = 0; page < PAGES_PER_CHANNEL_RUN && ch.uploads_playlist; page++) {
    const body = await client.get('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: ch.uploads_playlist,
      maxResults: 50,
      pageToken,
    })
    let reachedKnown = false
    for (const it of body.items || []) {
      const id = it.contentDetails?.videoId
      if (!id) continue
      if (ch.backfill_done && hasVideo.get(id)) {
        reachedKnown = true
        break
      }
      const title = it.snippet?.title || ''
      upsertVideo.run(id, ch.channel_id, title, it.contentDetails?.videoPublishedAt ?? null, match(title))
      added++
    }
    pageToken = body.nextPageToken || null
    if (reachedKnown || !pageToken) {
      done = true
      pageToken = null
      break
    }
  }
  const backfillDone = ch.backfill_done || done ? 1 : 0
  updateChannel.run(
    ch.channel_id,
    ch.title,
    ch.uploads_playlist,
    pageToken,
    backfillDone,
    now.toISOString(),
    null,
    handle
  )
  return added
}

/** Diziye eşlenmiş bütün videoların güncel sayıları (50'şerli) ve bugünün dizi toplamı. */
async function refreshStats(client, now) {
  const ids = db
    .prepare('SELECT video_id FROM yt_public_videos WHERE series_id IS NOT NULL')
    .all()
    .map((r) => r.video_id)
  const stamp = now.toISOString()
  for (let i = 0; i < ids.length; i += 50) {
    const body = await client.get('videos', { part: 'statistics', id: ids.slice(i, i + 50).join(','), maxResults: 50 })
    for (const it of body.items || []) {
      const s = it.statistics || {}
      setStats.run(
        s.viewCount != null ? Number(s.viewCount) : null,
        s.likeCount != null ? Number(s.likeCount) : null,
        s.commentCount != null ? Number(s.commentCount) : null,
        stamp,
        it.id
      )
    }
  }
  upsertDaily.run(stamp.slice(0, 10))
  return ids.length
}

/** Dizi başına son bölümlerden yorum örneklemi → dil dağılımı (haftada bir). */
async function sampleComments(client, now) {
  const due = db
    .prepare(
      `SELECT v.series_id, MAX(c.sampled_at) last FROM yt_public_videos v
       LEFT JOIN yt_comment_langs c ON c.series_id = v.series_id
       WHERE v.series_id IS NOT NULL GROUP BY v.series_id`
    )
    .all()
    .filter((r) => !r.last || now - new Date(r.last) >= COMMENT_EVERY_MS)
  let series = 0
  for (const { series_id: seriesId } of due) {
    const vids = db
      .prepare(
        `SELECT video_id FROM yt_public_videos WHERE series_id = ? AND COALESCE(comments, 1) > 0
         ORDER BY published_at DESC LIMIT ?`
      )
      .all(seriesId, COMMENT_VIDEOS)
    const texts = []
    for (const { video_id: videoId } of vids) {
      try {
        const body = await client.get('commentThreads', {
          part: 'snippet',
          videoId,
          maxResults: COMMENT_PER_VIDEO,
          order: 'relevance',
          textFormat: 'plainText',
        })
        for (const it of body.items || []) texts.push(it.snippet?.topLevelComment?.snippet?.textOriginal || '')
      } catch (err) {
        if (err instanceof QuotaExhausted) throw err
        // yorumları kapalı video: atlanır
      }
    }
    if (!texts.length) continue
    const dist = languageDistribution(texts)
    const stamp = now.toISOString()
    db.prepare('DELETE FROM yt_comment_langs WHERE series_id = ?').run(seriesId)
    const ins = db.prepare(
      'INSERT INTO yt_comment_langs (series_id, lang, comments, sampled, sampled_at) VALUES (?, ?, ?, ?, ?)'
    )
    for (const l of dist.langs) ins.run(seriesId, l.lang, l.comments, dist.total, stamp)
    series++
  }
  return series
}

let running = false

/**
 * Günlük iş: kanallar → istatistik → (haftalık) yorum dili. Kota dolarsa kalan iş ertesi güne kalır.
 * `force`: 24 saat dolmadan çalıştır (yönetim ekranındaki "Şimdi topla").
 */
export async function runYoutubePublicIfNeeded({
  cfg = publicConfig(),
  fetchFn = fetch,
  now = new Date(),
  series = catalogSeries(),
  force = false,
} = {}) {
  if (!cfg.ready || running) return null
  const last = metaGet.get('ytPublicLastRun')?.value
  if (!force && last && now - new Date(last) < RUN_EVERY_MS) return null
  running = true
  const client = makeClient({ cfg, fetchFn, now })
  const result = { videos: 0, statsVideos: 0, commentSeries: 0, errors: [], quotaExhausted: false }
  try {
    const match = buildTitleMatcher(series, { englishTitlesOf: (s) => getEnglishTitles(s.id, s.name) })
    for (const handle of cfg.handles) {
      try {
        result.videos += await syncChannelVideos(handle, client, match, now)
      } catch (err) {
        if (err instanceof QuotaExhausted) throw err
        insertChannel.run(handle)
        db.prepare('UPDATE yt_public_channels SET last_run_at = ?, last_error = ? WHERE handle = ?').run(
          now.toISOString(),
          err.message,
          handle
        )
        result.errors.push(`${handle}: ${err.message}`)
      }
    }
    result.statsVideos = await refreshStats(client, now)
    result.commentSeries = await sampleComments(client, now)
    metaSet.run('ytPublicLastRun', now.toISOString())
  } catch (err) {
    if (!(err instanceof QuotaExhausted)) throw err
    result.quotaExhausted = true
    console.warn('[youtube-public] günlük kota doldu; kalan iş ertesi güne kaldı')
  } finally {
    running = false
  }
  result.quotaUsed = client.used
  return result
}

// ---------------------------------------------------------------------------------------------- okuma

export function publicStatus({ cfg = publicConfig(), now = new Date() } = {}) {
  const counts = new Map(
    db
      .prepare('SELECT channel_id, COUNT(*) videos, COUNT(series_id) matched FROM yt_public_videos GROUP BY channel_id')
      .all()
      .map((r) => [r.channel_id, r])
  )
  const channels = cfg.handles.map((handle) => {
    const c = getChannel.get(handle)
    const n = c?.channel_id ? counts.get(c.channel_id) : null
    return {
      handle,
      title: c?.title ?? null,
      videos: n?.videos ?? 0,
      matched: n?.matched ?? 0,
      backfillDone: Boolean(c?.backfill_done),
      lastRunAt: c?.last_run_at ?? null,
      lastError: c?.last_error ?? null,
    }
  })
  const series = db.prepare('SELECT COUNT(DISTINCT series_id) n FROM yt_series_daily').get().n
  return {
    configured: cfg.ready,
    channels,
    series,
    quotaUsedToday: quotaUsedToday(now),
    dailyQuota: cfg.dailyQuota,
    lastRunAt: metaGet.get('ytPublicLastRun')?.value ?? null,
  }
}

/**
 * Dizi sayfası: resmî kanallardaki bölüm videolarının toplamı, son ~30 gündeki artış, 90 günlük seyir ve yorum
 * dili dağılımı. Veri yoksa null.
 */
export function getSeriesYoutube(seriesId) {
  const history = db
    .prepare(
      'SELECT date, videos, views, likes, comments FROM yt_series_daily WHERE series_id = ? ORDER BY date DESC LIMIT 90'
    )
    .all(seriesId)
    .reverse()
  if (!history.length) return null
  const last = history.at(-1)
  const lastDate = new Date(`${last.date}T00:00:00Z`)
  const base = [...history].reverse().find((h) => lastDate - new Date(`${h.date}T00:00:00Z`) >= 28 * 86400000)
  const langs = db
    .prepare(
      'SELECT lang, comments, sampled, sampled_at FROM yt_comment_langs WHERE series_id = ? ORDER BY comments DESC'
    )
    .all(seriesId)
  const known = langs.reduce((s, l) => s + l.comments, 0)
  return {
    totals: { videos: last.videos, views: last.views, likes: last.likes, comments: last.comments, date: last.date },
    growth30: base ? { views: last.views - base.views, since: base.date } : null,
    history: history.map((h) => ({ date: h.date, views: h.views })),
    comments: langs.length
      ? {
          sampled: langs[0].sampled,
          sampledAt: langs[0].sampled_at,
          langs: langs.map((l) => ({ lang: l.lang, comments: l.comments, share: known ? l.comments / known : 0 })),
        }
      : null,
  }
}
