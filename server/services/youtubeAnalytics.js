import crypto from 'node:crypto'
import db from '../db.js'
import { getCached } from '../cache.js'
import { asciiVariant, foldTitle, getEnglishTitles } from './localTitles.js'

// YouTube Analytics (2026-10-06): yayıncı kanalların (ATV, Show TV, Kanal D…) sahipleri platforma salt okunur
// izin verir; kanalın kendi raporlarından dizi × ülke × ay izlenme ve izlenme süresi çekilir. Yayın kataloğu
// tutulmayan ülkelerde (Afrika, Asya) ölçülmüş tek izlenme sinyali bu olabilir.
//
// Akış: yönetici "Kanal bağla" → Google onay ekranı (kanal sahibi kendi hesabıyla onaylar) → geri dönüşte
// yenileme anahtarı şifrelenip saklanır → günlük eşitleme: yeni videolar listelenir, başlıktan dizilere
// eşlenir, tamamlanmış aylar için ülke kırılımlı rapor alınır. Şifre hiçbir aşamada platforma gelmez.
// Ağ çağrıları `fetchFn` ile verilir (testler sahte yanıt kullanır).

export const SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
]
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const DATA_API = 'https://www.googleapis.com/youtube/v3'
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports'

const STATE_TTL_MS = 10 * 60 * 1000
const PAGES_PER_RUN = 200 // 50 video/sayfa → çalıştırma başına en çok 10.000 video; kalan ertesi gün sürer
const BACKFILL_MONTHS = 12
const VIDEO_FILTER_CHUNK = 200
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------------------------- yapılandırma

export function youtubeConfig(env = process.env) {
  const values = {
    YOUTUBE_CLIENT_ID: env.YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET: env.YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI: env.YOUTUBE_REDIRECT_URI,
    YOUTUBE_TOKEN_KEY: env.YOUTUBE_TOKEN_KEY,
  }
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  return {
    clientId: values.YOUTUBE_CLIENT_ID,
    clientSecret: values.YOUTUBE_CLIENT_SECRET,
    redirectUri: values.YOUTUBE_REDIRECT_URI,
    tokenKey: values.YOUTUBE_TOKEN_KEY,
    ready: missing.length === 0,
    missing,
  }
}

// ---------------------------------------------------------------------------------------------- şifreleme

const keyOf = (secret) => crypto.createHash('sha256').update(String(secret)).digest()

/** Yenileme anahtarı AES-256-GCM ile şifrelenir: `v1:iv:etiket:şifreli` (base64). */
export function encryptToken(plain, secret) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}

export function decryptToken(payload, secret) {
  const [v, iv, tag, enc] = String(payload).split(':')
  if (v !== 'v1') throw new Error('Bilinmeyen anahtar biçimi')
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8')
}

// ---------------------------------------------------------------------------------------------- yetkilendirme

const states = new Map() // state → { userId, expiresAt }

/** Onay ekranına gidişte tek kullanımlık durum anahtarı (CSRF): dönüşte aynı kullanıcıyla eşleşmeli. */
export function createOAuthState(userId, now = Date.now()) {
  for (const [k, v] of states) if (v.expiresAt < now) states.delete(k)
  const state = crypto.randomBytes(24).toString('hex')
  states.set(state, { userId, expiresAt: now + STATE_TTL_MS })
  return state
}

export function consumeOAuthState(state, userId, now = Date.now()) {
  const entry = states.get(state)
  states.delete(state)
  return Boolean(entry && entry.userId === userId && entry.expiresAt >= now)
}

export function buildAuthUrl(state, cfg = youtubeConfig()) {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', cfg.clientId)
  url.searchParams.set('redirect_uri', cfg.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline') // yenileme anahtarı için
  url.searchParams.set('prompt', 'consent') // daha önce izin verilmiş hesapta da yenileme anahtarı dönsün
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  return url.toString()
}

async function postForm(url, form, fetchFn) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw Object.assign(new Error(body.error_description || body.error || `HTTP ${res.status}`), { status: res.status })
  return body
}

export function exchangeCode(code, cfg, fetchFn = fetch) {
  return postForm(
    TOKEN_URL,
    {
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchFn
  )
}

export async function refreshAccessToken(refreshToken, cfg, fetchFn = fetch) {
  const body = await postForm(
    TOKEN_URL,
    {
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    },
    fetchFn
  )
  return body.access_token
}

async function googleGet(url, accessToken, fetchFn) {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return body
}

// ---------------------------------------------------------------------------------------------- kayıt

const upsertChannelStmt = db.prepare(`
  INSERT INTO youtube_channels (channel_id, title, thumbnail, uploads_playlist, refresh_token_enc, connected_by, connected_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id) DO UPDATE SET
    title = excluded.title, thumbnail = excluded.thumbnail, uploads_playlist = excluded.uploads_playlist,
    refresh_token_enc = excluded.refresh_token_enc, connected_by = excluded.connected_by,
    connected_at = excluded.connected_at, last_error = NULL
`)
const getChannelStmt = db.prepare('SELECT * FROM youtube_channels WHERE channel_id = ?')
const listChannelsStmt = db.prepare('SELECT * FROM youtube_channels ORDER BY title')
const upsertVideoStmt = db.prepare(`
  INSERT INTO youtube_videos (video_id, channel_id, title, published_at, series_id) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, series_id = excluded.series_id
`)
const hasVideoStmt = db.prepare('SELECT 1 FROM youtube_videos WHERE video_id = ?')
const upsertViewsStmt = db.prepare(`
  INSERT INTO youtube_country_views (channel_id, series_id, iso2, period, views, minutes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id, series_id, iso2, period) DO UPDATE SET
    views = excluded.views, minutes = excluded.minutes, updated_at = excluded.updated_at
`)

/**
 * Onay ekranından dönüş: kodu anahtarla değiştirir, onaylanan kanalı okur, yenileme anahtarını şifreli saklar.
 * Dönüş: { channelId, title }.
 */
export async function connectChannel({ code, userId, cfg = youtubeConfig(), fetchFn = fetch, now = new Date() }) {
  const tokens = await exchangeCode(code, cfg, fetchFn)
  if (!tokens.refresh_token) {
    throw new Error('Google yenileme anahtarı döndürmedi; bağlantıyı kaldırıp yeniden onaylayın')
  }
  const me = await googleGet(`${DATA_API}/channels?part=snippet,contentDetails&mine=true`, tokens.access_token, fetchFn)
  const ch = me.items?.[0]
  if (!ch) throw new Error('Onaylanan hesapta YouTube kanalı bulunamadı')
  upsertChannelStmt.run(
    ch.id,
    ch.snippet?.title || ch.id,
    ch.snippet?.thumbnails?.default?.url ?? null,
    ch.contentDetails?.relatedPlaylists?.uploads ?? null,
    encryptToken(tokens.refresh_token, cfg.tokenKey),
    userId ?? null,
    now.toISOString()
  )
  return { channelId: ch.id, title: ch.snippet?.title || ch.id }
}

/** Bağlantıyı kaldırır: Google'daki izni geri alır (başarısız olsa da) ve kanalın bütün verisini siler. */
export async function disconnectChannel(channelId, { cfg = youtubeConfig(), fetchFn = fetch } = {}) {
  const row = getChannelStmt.get(channelId)
  if (!row) return false
  try {
    const token = decryptToken(row.refresh_token_enc, cfg.tokenKey)
    await fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' })
  } catch (err) {
    console.error(`[youtube] ${channelId} izni geri alınamadı (veri yine de silinir):`, err.message)
  }
  db.prepare('DELETE FROM youtube_country_views WHERE channel_id = ?').run(channelId)
  db.prepare('DELETE FROM youtube_videos WHERE channel_id = ?').run(channelId)
  db.prepare('DELETE FROM youtube_channels WHERE channel_id = ?').run(channelId)
  return true
}

// ---------------------------------------------------------------------------------------------- eşleme

/**
 * Video başlığından dizi: katalogdaki Türkçe ad, Türkçe harfsiz yazımı ve İngilizce adları. Başlık adla
 * başlıyorsa ya da (en az 8 harflik) adı içeriyorsa eşleşir; kısa adlar ("Anne", "Elif") yalnızca başta
 * geçerse sayılır. Birden çok aday varsa en uzun ad kazanır ("Kuruluş: Orhan" > "Kuruluş").
 */
export function buildTitleMatcher(series, { englishTitlesOf = () => [] } = {}) {
  const keys = []
  for (const s of series) {
    const names = new Set([s.name, asciiVariant(s.name), ...englishTitlesOf(s)].filter(Boolean))
    for (const n of names) {
      const k = foldTitle(n)
      if (k.length >= 3) keys.push({ k, id: s.id })
    }
  }
  keys.sort((a, b) => b.k.length - a.k.length)
  return (title) => {
    const t = foldTitle(title)
    if (!t) return null
    for (const { k, id } of keys) {
      if (t.startsWith(k) || (k.length >= 8 && t.includes(k))) return id
    }
    return null
  }
}

function catalogSeries() {
  return getCached('raw-series-providers')?.series || []
}

// ---------------------------------------------------------------------------------------------- eşitleme

const monthKey = (d) => d.toISOString().slice(0, 7)

/** Son tamamlanmış ay dahil, en çok `n` ay geriye (eskiden yeniye) — 'YYYY-MM'. */
export function completedMonths(now = new Date(), n = BACKFILL_MONTHS, from = null) {
  const out = []
  for (let i = n; i >= 1; i--) {
    const m = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))
    if (!from || m >= from) out.push(m)
  }
  return out
}

function monthRange(period) {
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { startDate: `${period}-01`, endDate: `${period}-${String(last).padStart(2, '0')}` }
}

/** Yükleme listesinden yeni videolar (en yeniden eskiye): bilinen videoya gelince durur; ilk doldurma sayfa sayfa sürer. */
async function listNewVideos(ch, accessToken, fetchFn) {
  if (!ch.uploads_playlist) return { videos: [], nextToken: null, done: true }
  const videos = []
  let pageToken = ch.backfill_done ? null : ch.backfill_page_token
  let reachedKnown = false
  for (let page = 0; page < PAGES_PER_RUN; page++) {
    const url = new URL(`${DATA_API}/playlistItems`)
    url.searchParams.set('part', 'snippet,contentDetails')
    url.searchParams.set('playlistId', ch.uploads_playlist)
    url.searchParams.set('maxResults', '50')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const body = await googleGet(url.toString(), accessToken, fetchFn)
    for (const it of body.items || []) {
      const id = it.contentDetails?.videoId
      if (!id) continue
      if (ch.backfill_done && hasVideoStmt.get(id)) {
        reachedKnown = true
        break
      }
      videos.push({ id, title: it.snippet?.title || '', publishedAt: it.contentDetails?.videoPublishedAt ?? null })
    }
    pageToken = body.nextPageToken || null
    if (reachedKnown || !pageToken) return { videos, nextToken: null, done: true }
  }
  return { videos, nextToken: pageToken, done: false }
}

async function countryReport(accessToken, period, videoIds, fetchFn) {
  const { startDate, endDate } = monthRange(period)
  const totals = new Map()
  const chunks = videoIds ? [] : [null]
  if (videoIds)
    for (let i = 0; i < videoIds.length; i += VIDEO_FILTER_CHUNK) chunks.push(videoIds.slice(i, i + VIDEO_FILTER_CHUNK))
  for (const chunk of chunks) {
    const url = new URL(ANALYTICS_API)
    url.searchParams.set('ids', 'channel==MINE')
    url.searchParams.set('startDate', startDate)
    url.searchParams.set('endDate', endDate)
    url.searchParams.set('metrics', 'views,estimatedMinutesWatched')
    url.searchParams.set('dimensions', 'country')
    if (chunk) url.searchParams.set('filters', `video==${chunk.join(',')}`)
    const body = await googleGet(url.toString(), accessToken, fetchFn)
    const cols = (body.columnHeaders || []).map((c) => c.name)
    const ci = cols.indexOf('country')
    const vi = cols.indexOf('views')
    const mi = cols.indexOf('estimatedMinutesWatched')
    for (const row of body.rows || []) {
      const iso2 = String(row[ci] || '').toUpperCase()
      if (!/^[A-Z]{2}$/.test(iso2)) continue
      const t = totals.get(iso2) || { views: 0, minutes: 0 }
      t.views += Number(row[vi]) || 0
      t.minutes += Number(row[mi]) || 0
      totals.set(iso2, t)
    }
  }
  return totals
}

/**
 * Tek kanalı eşitler: yeni videolar → dizi eşlemesi → tamamlanmış aylar için kanal toplamı ve dizi başına
 * ülke kırılımı. İlk eşitlemede son 12 ay, sonrakilerde son 2 tamamlanmış ay yeniden hesaplanır.
 */
export async function syncChannel(
  channelId,
  { cfg = youtubeConfig(), fetchFn = fetch, now = new Date(), series = catalogSeries(), onProgress } = {}
) {
  const ch = getChannelStmt.get(channelId)
  if (!ch) throw new Error('Kanal bağlı değil')
  const setStatus = db.prepare('UPDATE youtube_channels SET last_sync_at = ?, last_error = ? WHERE channel_id = ?')
  try {
    const accessToken = await refreshAccessToken(decryptToken(ch.refresh_token_enc, cfg.tokenKey), cfg, fetchFn)

    onProgress?.({ phase: 'videos' })
    const { videos, nextToken, done } = await listNewVideos(ch, accessToken, fetchFn)
    const match = buildTitleMatcher(series, { englishTitlesOf: (s) => getEnglishTitles(s.id, s.name) })
    for (const v of videos) upsertVideoStmt.run(v.id, channelId, v.title, v.publishedAt, match(v.title))
    db.prepare('UPDATE youtube_channels SET backfill_page_token = ?, backfill_done = ? WHERE channel_id = ?').run(
      nextToken,
      done ? 1 : 0,
      channelId
    )

    const lastFull = completedMonths(now, 1)[0]
    const months = ch.last_full_month ? completedMonths(now, 2) : completedMonths(now, BACKFILL_MONTHS)
    const bySeries = new Map()
    for (const r of db
      .prepare('SELECT series_id, video_id FROM youtube_videos WHERE channel_id = ? AND series_id IS NOT NULL')
      .all(channelId)) {
      if (!bySeries.has(r.series_id)) bySeries.set(r.series_id, [])
      bySeries.get(r.series_id).push(r.video_id)
    }
    const stamp = now.toISOString()
    let rows = 0
    for (const [i, period] of months.entries()) {
      onProgress?.({ phase: 'reports', done: i, total: months.length, current: period })
      const kanal = await countryReport(accessToken, period, null, fetchFn)
      for (const [iso2, t] of kanal) {
        upsertViewsStmt.run(channelId, 0, iso2, period, Math.round(t.views), Math.round(t.minutes), stamp)
        rows++
      }
      for (const [seriesId, ids] of bySeries) {
        const totals = await countryReport(accessToken, period, ids, fetchFn)
        for (const [iso2, t] of totals) {
          upsertViewsStmt.run(channelId, seriesId, iso2, period, Math.round(t.views), Math.round(t.minutes), stamp)
          rows++
        }
      }
    }
    db.prepare('UPDATE youtube_channels SET last_full_month = ? WHERE channel_id = ?').run(lastFull, channelId)
    setStatus.run(stamp, null, channelId)
    return { newVideos: videos.length, matchedSeries: bySeries.size, months: months.length, rows, backfillDone: done }
  } catch (err) {
    setStatus.run(now.toISOString(), err.message, channelId)
    throw err
  }
}

let syncRunning = false

/** Zamanlayıcı: yapılandırma tamamsa, son eşitlemesi 24 saatten eski her kanal. */
export async function runYoutubeSyncIfNeeded({ cfg = youtubeConfig(), now = new Date(), sync = syncChannel } = {}) {
  if (!cfg.ready || syncRunning) return null
  syncRunning = true
  const sonuc = []
  try {
    for (const ch of listChannelsStmt.all()) {
      if (ch.last_sync_at && now - new Date(ch.last_sync_at) < SYNC_EVERY_MS && !ch.last_error) continue
      try {
        sonuc.push({ channelId: ch.channel_id, ...(await sync(ch.channel_id, { cfg, now })) })
      } catch (err) {
        console.error(`[youtube] ${ch.title} eşitlenemedi:`, err.message)
        sonuc.push({ channelId: ch.channel_id, error: err.message })
      }
    }
    return sonuc
  } finally {
    syncRunning = false
  }
}

// ---------------------------------------------------------------------------------------------- okuma

/** Yönetici ekranı: bağlı kanallar ve eşitleme durumu (anahtar asla dışarı verilmez). */
export function listChannels() {
  const stats = db.prepare(`
    SELECT channel_id, COUNT(*) videos, COUNT(series_id) matched, COUNT(DISTINCT series_id) series
    FROM youtube_videos GROUP BY channel_id
  `)
  const byId = new Map(stats.all().map((r) => [r.channel_id, r]))
  const countries = db.prepare(
    'SELECT channel_id, COUNT(DISTINCT iso2) n, MAX(period) last FROM youtube_country_views WHERE series_id = 0 GROUP BY channel_id'
  )
  const cById = new Map(countries.all().map((r) => [r.channel_id, r]))
  return listChannelsStmt.all().map((c) => ({
    channelId: c.channel_id,
    title: c.title,
    thumbnail: c.thumbnail,
    connectedAt: c.connected_at,
    lastSyncAt: c.last_sync_at,
    lastError: c.last_error,
    backfillDone: Boolean(c.backfill_done),
    videos: byId.get(c.channel_id)?.videos ?? 0,
    matchedVideos: byId.get(c.channel_id)?.matched ?? 0,
    series: byId.get(c.channel_id)?.series ?? 0,
    countries: cById.get(c.channel_id)?.n ?? 0,
    lastPeriod: cById.get(c.channel_id)?.last ?? null,
  }))
}

/**
 * Ülke başına son 12 ayın YouTube izlenmesi (bütün bağlı kanallar). `seriesId` verilirse o dizi, verilmezse
 * kanal toplamları. Dönüş: [{ iso2, views, minutes }] çoktan aza.
 */
export function getYoutubeCountryViews({ seriesId = 0, now = new Date() } = {}) {
  const from = completedMonths(now, 12)[0]
  return db
    .prepare(
      `SELECT iso2, SUM(views) views, SUM(minutes) minutes FROM youtube_country_views
       WHERE series_id = ? AND period >= ? GROUP BY iso2 ORDER BY views DESC`
    )
    .all(seriesId, from)
    .map((r) => ({ iso2: r.iso2, views: r.views, minutes: r.minutes }))
}
