import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import {
  youtubeConfig,
  encryptToken,
  decryptToken,
  createOAuthState,
  consumeOAuthState,
  buildAuthUrl,
  buildTitleMatcher,
  completedMonths,
  connectChannel,
  syncChannel,
  disconnectChannel,
  listChannels,
  getYoutubeCountryViews,
  runYoutubeSyncIfNeeded,
  SCOPES,
} from './youtubeAnalytics.js'

const cfg = {
  clientId: 'istemci',
  clientSecret: 'gizli',
  redirectUri: 'http://localhost:5173/api/youtube/oauth/callback',
  tokenKey: 'test-anahtari',
  ready: true,
  missing: [],
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** Google uçlarını taklit eden sahte fetch: çağrıları kaydeder. */
function sahteGoogle({ videos = [], report = () => ({ rows: [] }) } = {}) {
  const calls = []
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url)
    calls.push({ url: u, opts })
    if (u.href.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(opts.body)
      return form.get('grant_type') === 'authorization_code'
        ? json({ access_token: 'erisim-1', refresh_token: 'yenileme-anahtari' })
        : json({ access_token: 'erisim-2' })
    }
    if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) return json({})
    if (u.pathname.endsWith('/channels'))
      return json({
        items: [
          {
            id: 'UCatv',
            snippet: { title: 'atv', thumbnails: { default: { url: 'https://x/t.jpg' } } },
            contentDetails: { relatedPlaylists: { uploads: 'UUatv' } },
          },
        ],
      })
    if (u.pathname.endsWith('/playlistItems'))
      return json({
        items: videos.map((v) => ({
          contentDetails: { videoId: v.id, videoPublishedAt: '2026-09-01T00:00:00Z' },
          snippet: { title: v.title },
        })),
      })
    if (u.hostname === 'youtubeanalytics.googleapis.com')
      return json({
        columnHeaders: [{ name: 'country' }, { name: 'views' }, { name: 'estimatedMinutesWatched' }],
        ...report(u),
      })
    throw new Error(`beklenmeyen istek ${u.href}`)
  }
  return { fetchFn, calls }
}

beforeEach(() => {
  for (const t of ['youtube_country_views', 'youtube_videos', 'youtube_channels']) db.prepare(`DELETE FROM ${t}`).run()
})

describe('yapılandırma, şifreleme, onay adresi', () => {
  it('eksik ortam değişkenleri listelenir', () => {
    expect(youtubeConfig({}).missing).toEqual([
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET',
      'YOUTUBE_REDIRECT_URI',
      'YOUTUBE_TOKEN_KEY',
    ])
    expect(youtubeConfig({}).ready).toBe(false)
  })

  it('yenileme anahtarı şifreli saklanır, yanlış anahtarla çözülmez', () => {
    const enc = encryptToken('1//gizli-yenileme', 'k1')
    expect(enc).not.toContain('gizli')
    expect(decryptToken(enc, 'k1')).toBe('1//gizli-yenileme')
    expect(() => decryptToken(enc, 'k2')).toThrow()
  })

  it('durum anahtarı tek kullanımlık ve kullanıcıya bağlı', () => {
    const s = createOAuthState('u1')
    expect(consumeOAuthState(s, 'u2')).toBe(false)
    const s2 = createOAuthState('u1')
    expect(consumeOAuthState(s2, 'u1')).toBe(true)
    expect(consumeOAuthState(s2, 'u1')).toBe(false)
    const eski = createOAuthState('u1', Date.now() - 11 * 60 * 1000)
    expect(consumeOAuthState(eski, 'u1')).toBe(false)
  })

  it('onay adresi salt okunur kapsamları, çevrimdışı erişimi ve durumu taşır', () => {
    const u = new URL(buildAuthUrl('durum123', cfg))
    expect(u.searchParams.get('scope')).toBe(SCOPES.join(' '))
    expect(SCOPES.every((s) => s.endsWith('.readonly'))).toBe(true)
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('state')).toBe('durum123')
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri)
  })
})

describe('video başlığından dizi', () => {
  const match = buildTitleMatcher(
    [
      { id: 1, name: 'Kuruluş Osman' },
      { id: 2, name: 'Kuruluş: Orhan' },
      { id: 3, name: 'Anne' },
      { id: 4, name: 'Kızılcık Şerbeti' },
    ],
    { englishTitlesOf: (s) => (s.id === 4 ? ['Cranberry Sorbet'] : []) }
  )

  it('başta geçen ad eşleşir; uzun ad kısa adı yener; Türkçe harfsiz yazım ve İngilizce ad da tanınır', () => {
    expect(match('Kuruluş Osman 167. Bölüm @atvturkiye')).toBe(1)
    expect(match('Kuruluş: Orhan 3. Bölüm Fragmanı')).toBe(2)
    expect(match('Kurulus Osman Episode 167 (English Subtitles)')).toBe(1)
    expect(match('Cranberry Sorbet Episode 1')).toBe(4)
  })

  it('kısa ad yalnızca başta geçerse; uzun ad başlığın içinde de geçebilir', () => {
    expect(match('Anne 12. Bölüm')).toBe(3)
    expect(match('Benim adım Anne değil')).toBeNull()
    expect(match('Fragman | Kızılcık Şerbeti 85. Bölüm')).toBe(4)
    expect(match('Haber bülteni')).toBeNull()
  })
})

describe('bağlama ve eşitleme (sahte Google)', () => {
  const series = [
    { id: 1, name: 'Kuruluş Osman' },
    { id: 4, name: 'Kızılcık Şerbeti' },
  ]
  const now = new Date('2026-10-06T10:00:00Z')

  it('bağlanan kanal şifreli saklanır; eşitleme videoları eşler, kanal ve dizi başına ülke kırılımını yazar', async () => {
    const { fetchFn, calls } = sahteGoogle({
      videos: [
        { id: 'v1', title: 'Kuruluş Osman 167. Bölüm' },
        { id: 'v2', title: 'Kuruluş Osman 166. Bölüm' },
        { id: 'v3', title: 'Haber bülteni' },
      ],
      report: (u) =>
        u.searchParams.get('filters')
          ? {
              rows: [
                ['RW', 120, 900],
                ['PK', 5000, 40000],
              ],
            }
          : {
              rows: [
                ['RW', 300, 2000],
                ['PK', 9000, 70000],
                ['ZZZ', 1, 1],
              ],
            },
    })
    const { channelId, title } = await connectChannel({ code: 'kod', userId: 'admin', cfg, fetchFn, now })
    expect({ channelId, title }).toEqual({ channelId: 'UCatv', title: 'atv' })
    const row = db.prepare('SELECT refresh_token_enc FROM youtube_channels').get()
    expect(row.refresh_token_enc).not.toContain('yenileme-anahtari')

    const r = await syncChannel('UCatv', { cfg, fetchFn, now, series })
    expect(r).toMatchObject({ newVideos: 3, matchedSeries: 1, months: 12, backfillDone: true })
    const filtreli = calls.find((c) => c.url.searchParams.get('filters'))
    expect(filtreli.url.searchParams.get('filters')).toBe('video==v1,v2')
    expect(filtreli.url.searchParams.get('dimensions')).toBe('country')
    expect(filtreli.opts.headers.Authorization).toBe('Bearer erisim-2')

    expect(getYoutubeCountryViews({ now })).toEqual([
      { iso2: 'PK', views: 9000 * 12, minutes: 70000 * 12 },
      { iso2: 'RW', views: 300 * 12, minutes: 2000 * 12 },
    ])
    expect(getYoutubeCountryViews({ seriesId: 1, now })[1]).toEqual({ iso2: 'RW', views: 1440, minutes: 10800 })
    expect(listChannels()[0]).toMatchObject({ videos: 3, matchedVideos: 2, series: 1, countries: 2, lastError: null })
    expect(JSON.stringify(listChannels())).not.toContain('refresh')
  })

  it('ikinci eşitleme yalnızca son 2 ayı yeniden hesaplar ve bilinen videoda durur', async () => {
    const g = sahteGoogle({ videos: [{ id: 'v1', title: 'Kuruluş Osman 167. Bölüm' }] })
    await connectChannel({ code: 'kod', userId: 'admin', cfg, fetchFn: g.fetchFn, now })
    await syncChannel('UCatv', { cfg, fetchFn: g.fetchFn, now, series })
    const g2 = sahteGoogle({
      videos: [
        { id: 'v9', title: 'Kızılcık Şerbeti 90. Bölüm' },
        { id: 'v1', title: 'Kuruluş Osman 167. Bölüm' },
      ],
    })
    const r = await syncChannel('UCatv', { cfg, fetchFn: g2.fetchFn, now, series })
    expect(r).toMatchObject({ newVideos: 1, months: 2, matchedSeries: 2 })
  })

  it('Google hatası kanala yazılır; bağlantı kaldırılınca izin geri alınır ve veri silinir', async () => {
    const g = sahteGoogle()
    await connectChannel({ code: 'kod', userId: 'admin', cfg, fetchFn: g.fetchFn, now })
    const bozuk = async (url) =>
      String(url).includes('token') ? json({ error: 'invalid_grant' }, 400) : g.fetchFn(url)
    await expect(syncChannel('UCatv', { cfg, fetchFn: bozuk, now, series })).rejects.toThrow('invalid_grant')
    expect(listChannels()[0].lastError).toBe('invalid_grant')

    expect(await disconnectChannel('UCatv', { cfg, fetchFn: g.fetchFn })).toBe(true)
    expect(g.calls.some((c) => c.url.href.startsWith('https://oauth2.googleapis.com/revoke'))).toBe(true)
    expect(listChannels()).toEqual([])
  })

  it('zamanlayıcı yapılandırma yoksa hiçbir şey yapmaz; 24 saat dolmayan kanalı atlar', async () => {
    expect(await runYoutubeSyncIfNeeded({ cfg: { ...cfg, ready: false } })).toBeNull()
    const g = sahteGoogle()
    await connectChannel({ code: 'kod', userId: 'admin', cfg, fetchFn: g.fetchFn, now })
    const cagrilan = []
    const sync = async (id) => {
      cagrilan.push(id)
      return {}
    }
    await runYoutubeSyncIfNeeded({ cfg, now, sync })
    expect(cagrilan).toEqual(['UCatv'])
    db.prepare('UPDATE youtube_channels SET last_sync_at = ?').run(now.toISOString())
    await runYoutubeSyncIfNeeded({ cfg, now, sync })
    expect(cagrilan).toEqual(['UCatv'])
  })

  it('tamamlanmış aylar: içinde bulunulan ay dahil edilmez', () => {
    expect(completedMonths(now, 2)).toEqual(['2026-08', '2026-09'])
  })
})
