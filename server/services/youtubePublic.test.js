import { describe, it, expect, beforeEach } from 'vitest'
import db from '../db.js'
import { detectLanguage, languageDistribution } from './commentLanguage.js'
import {
  runYoutubePublicIfNeeded,
  getSeriesYoutube,
  publicStatus,
  publicConfig,
  quotaUsedToday,
} from './youtubePublic.js'

describe('yorum dili', () => {
  it('alfabeden ve sık kelimelerden dil; kısa ya da yalnızca emoji olan yorum sayılmaz', () => {
    expect(detectLanguage('مسلسل رائع جدا')).toBe('ar')
    expect(detectLanguage('خیلی سریال خوبیه، ممنون از ترجمه')).toBe('fa')
    expect(detectLanguage('Очень красивый сериал')).toBe('ru')
    expect(detectLanguage('Дуже гарний серіал, дякую')).toBe('uk')
    expect(detectLanguage('Bu dizi çok güzel, yeni bölüm ne zaman')).toBe('tr')
    expect(detectLanguage('Me encanta esta serie, el mejor capítulo')).toBe('es')
    expect(detectLanguage('I love this series so much')).toBe('en')
    expect(detectLanguage('Napenda sana tamthilia hii nzuri')).toBe('sw')
    expect(detectLanguage('Çox gözəl serialdır')).toBe('az')
    expect(detectLanguage('😍😍😍')).toBeNull()
    expect(detectLanguage('ok')).toBeNull()
  })

  it('dağılım: tanınmayanlar ayrı sayılır, paylar tanınanlar üzerinden', () => {
    const d = languageDistribution(['مسلسل رائع جدا', 'مسلسل جميل', 'Me encanta esta serie', '❤️'])
    expect(d).toMatchObject({ total: 4, unknown: 1 })
    expect(d.langs.map((l) => [l.lang, l.comments])).toEqual([
      ['ar', 2],
      ['es', 1],
    ])
    expect(d.langs[0].share).toBeCloseTo(2 / 3)
  })
})

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** Sahte YouTube Data API: kanal çözme, yükleme listesi, video sayıları, yorumlar. */
function sahteYoutube({ handles = { '@atvturkiye': 'UCatv' }, videos = [], stats = {}, comments = [] } = {}) {
  const calls = []
  const fetchFn = async (url) => {
    const u = new URL(url)
    calls.push(u)
    const p = u.searchParams
    if (u.pathname.endsWith('/channels')) {
      const id = handles[p.get('forHandle')]
      return json({
        items: id
          ? [{ id, snippet: { title: 'atv' }, contentDetails: { relatedPlaylists: { uploads: `UU${id}` } } }]
          : [],
      })
    }
    if (u.pathname.endsWith('/playlistItems'))
      return json({
        items: videos.map((v) => ({
          contentDetails: { videoId: v.id, videoPublishedAt: v.at },
          snippet: { title: v.title },
        })),
      })
    if (u.pathname.endsWith('/videos'))
      return json({
        items: p
          .get('id')
          .split(',')
          .map((id) => ({ id, statistics: stats[id] })),
      })
    if (u.pathname.endsWith('/commentThreads'))
      return json({ items: comments.map((t) => ({ snippet: { topLevelComment: { snippet: { textOriginal: t } } } })) })
    throw new Error(`beklenmeyen ${u.href}`)
  }
  return { fetchFn, calls }
}

const cfg = { apiKey: 'anahtar', ready: true, handles: ['@atvturkiye', '@yok'], dailyQuota: 8000 }
const series = [{ id: 1, name: 'Kuruluş Osman' }]

beforeEach(() => {
  for (const t of ['yt_public_channels', 'yt_public_videos', 'yt_series_daily', 'yt_comment_langs']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  db.prepare("DELETE FROM meta WHERE key LIKE 'ytPublic%'").run()
})

describe('herkese açık veri toplama (sahte YouTube)', () => {
  it('anahtar yoksa çalışmaz', async () => {
    expect(publicConfig({}).ready).toBe(false)
    expect(await runYoutubePublicIfNeeded({ cfg: { ...cfg, ready: false } })).toBeNull()
  })

  it('kanal çözülür, videolar eşlenir, dizi toplamı ve yorum dili yazılır; bulunamayan kanal hata olarak kalır', async () => {
    const g = sahteYoutube({
      videos: [
        { id: 'v1', title: 'Kuruluş Osman 167. Bölüm', at: '2026-10-01T00:00:00Z' },
        { id: 'v2', title: 'Kuruluş Osman 166. Bölüm', at: '2026-09-24T00:00:00Z' },
        { id: 'v3', title: 'Ana Haber Bülteni', at: '2026-10-01T00:00:00Z' },
      ],
      stats: { v1: { viewCount: '1000', likeCount: '50', commentCount: '10' }, v2: { viewCount: '3000' } },
      comments: ['مسلسل رائع جدا', 'Bu dizi çok güzel', 'Me encanta esta serie'],
    })
    const now = new Date('2026-10-06T10:00:00Z')
    const r = await runYoutubePublicIfNeeded({ cfg, fetchFn: g.fetchFn, now, series })
    expect(r).toMatchObject({ videos: 3, statsVideos: 2, commentSeries: 1, quotaExhausted: false })
    expect(r.errors).toEqual(['@yok: @yok adlı kanal bulunamadı'])
    expect(g.calls.every((u) => u.searchParams.get('key') === 'anahtar')).toBe(true)
    expect(quotaUsedToday(now)).toBe(r.quotaUsed)

    const s = getSeriesYoutube(1)
    expect(s.totals).toMatchObject({ videos: 2, views: 4000, likes: 50, comments: 10, date: '2026-10-06' })
    expect(s.growth30).toBeNull() // tek günlük veri
    expect(s.comments.langs.map((l) => l.lang).sort()).toEqual(['ar', 'es', 'tr'])
    expect(getSeriesYoutube(99)).toBeNull()

    const st = publicStatus({ cfg, now })
    expect(st.channels[0]).toMatchObject({ handle: '@atvturkiye', title: 'atv', videos: 3, matched: 2 })
    expect(st.channels[1].lastError).toMatch(/bulunamadı/)
  })

  it('24 saat dolmadan tekrar çalışmaz; 30 gün önceki toplamdan artış hesaplanır', async () => {
    const g = sahteYoutube({
      videos: [{ id: 'v1', title: 'Kuruluş Osman 1. Bölüm', at: '2026-08-01T00:00:00Z' }],
      stats: { v1: { viewCount: '1000' } },
    })
    await runYoutubePublicIfNeeded({ cfg, fetchFn: g.fetchFn, now: new Date('2026-09-01T10:00:00Z'), series })
    expect(
      await runYoutubePublicIfNeeded({ cfg, fetchFn: g.fetchFn, now: new Date('2026-09-01T20:00:00Z'), series })
    ).toBeNull()
    const g2 = sahteYoutube({ videos: [], stats: { v1: { viewCount: '2500' } } })
    await runYoutubePublicIfNeeded({ cfg, fetchFn: g2.fetchFn, now: new Date('2026-10-06T10:00:00Z'), series })
    expect(getSeriesYoutube(1).growth30).toEqual({ views: 1500, since: '2026-09-01' })
  })

  it('kota dolunca iş durur ve sonraki güne kalır', async () => {
    const g = sahteYoutube({ videos: [{ id: 'v1', title: 'Kuruluş Osman 1. Bölüm' }] })
    const r = await runYoutubePublicIfNeeded({
      cfg: { ...cfg, dailyQuota: 1 },
      fetchFn: g.fetchFn,
      now: new Date('2026-10-06T10:00:00Z'),
      series,
    })
    expect(r.quotaExhausted).toBe(true)
    expect(g.calls).toHaveLength(1)
  })
})
