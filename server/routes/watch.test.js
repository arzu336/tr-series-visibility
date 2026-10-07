import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'

// /api/watch/* ve /api/visibility içindeki watchSignal alanı. Servis sahte: pipeline.db ve
// World Bank'a çıkılmaz; rota sözleşmesi, doğrulama ve hata toleransı gerçek.

process.env.APP_PASSWORD = 'izlenme-test-sifresi-12'
process.env.ADMIN_EMAIL = 'izlenme-admin@example.com'

const sahteSinyal = {
  byIso2: {
    DE: {
      index: 42,
      level: 'Orta',
      confidence: 'orta',
      componentCount: 2,
      components: {},
      reason: 'test',
      warnings: [],
      opportunity: 'Doymuş',
    },
  },
  meta: { universe: 1, indexed: 1, weights: { netflix: 0.5, wiki: 0.3, search: 0.2, press: 0 } },
  generatedAt: '2026-09-30T00:00:00.000Z',
  listsWindow: { weeks: 52, from: '2025-09-28', available: true },
  contract: 'izlenme-sinyali-v1',
}

vi.mock('../services/watchSignal.js', async (orig) => {
  const gercek = await orig()
  return {
    ...gercek,
    getWatchSignals: vi.fn(async () => sahteSinyal),
    getSeriesGlobal: vi.fn(async () => ({
      status: 'hesaplandi',
      items: [{ tmdbId: 1, name: 'Terzi', countries: 68, weeks: 531 }],
    })),
    getCountrySeries: vi.fn(async (iso2) => ({ status: 'hesaplandi', iso2, items: [] })),
  }
})

vi.mock('../data-pipeline.js', async (orig) => {
  const gercek = await orig()
  return {
    ...gercek,
    getEnrichedVisibility: vi.fn(async () => ({
      data: {
        updatedAt: 'x',
        seriesCount: 1,
        countries: [
          { iso2: 'DE', score: 1, seriesCount: 3, dataSource: 'tmdb' },
          { iso2: 'FR', score: 1, seriesCount: 2, dataSource: 'tmdb' },
        ],
      },
      raw: { series: [], providersById: {} },
    })),
  }
})

const { app } = await import('../app.js')
const { findUserByEmail, listUsers, resetUserPassword } = await import('../users.js')
const watch = await import('../services/watchSignal.js')

let agent

beforeAll(async () => {
  const admin = findUserByEmail(process.env.ADMIN_EMAIL) || listUsers().find((u) => u.isAdmin)
  if (!admin) throw new Error("test DB'de yönetici yok")
  const sifre = resetUserPassword(admin.id)
  agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email: admin.email, password: sifre })
  expect(res.status).toBe(200)
})

describe('/api/watch/*', () => {
  it('oturumsuz istek 401', async () => {
    expect((await request(app).get('/api/watch/countries')).status).toBe(401)
  })

  it('GET /api/watch/countries sinyal sözleşmesini döner; fresh=1 önbelleği atlar', async () => {
    const res = await agent.get('/api/watch/countries?fresh=1')
    expect(res.status).toBe(200)
    expect(res.body.contract).toBe('izlenme-sinyali-v1')
    expect(res.body.byIso2.DE.index).toBe(42)
    expect(watch.getWatchSignals).toHaveBeenLastCalledWith({ fresh: true })
  })

  it('GET /api/watch/series-global', async () => {
    const res = await agent.get('/api/watch/series-global')
    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({ name: 'Terzi', countries: 68 })
  })

  it('GET /api/watch/country/:iso2/series — geçersiz kod 400, geçerli kod normalize edilir', async () => {
    expect((await agent.get('/api/watch/country/XYZ/series')).status).toBe(400)
    const res = await agent.get('/api/watch/country/de/series')
    expect(res.status).toBe(200)
    expect(res.body.iso2).toBe('DE')
  })
})

describe('/api/visibility içinde watchSignal', () => {
  it('her ülkeye watchSignal eklenir (yoksa null) ve meta taşınır', async () => {
    const res = await agent.get('/api/visibility')
    expect(res.status).toBe(200)
    const de = res.body.countries.find((c) => c.iso2 === 'DE')
    const fr = res.body.countries.find((c) => c.iso2 === 'FR')
    expect(de.watchSignal.index).toBe(42)
    expect(fr.watchSignal).toBeNull()
    expect(res.body.watchSignalMeta).toMatchObject({ universe: 1, listsWindow: { weeks: 52 } })
  })

  it('sinyal hesaplanamazsa görünürlük yine döner, watchSignal null', async () => {
    watch.getWatchSignals.mockRejectedValueOnce(new Error('pipeline yok'))
    const res = await agent.get('/api/visibility')
    expect(res.status).toBe(200)
    expect(res.body.countries[0].watchSignal).toBeNull()
    expect(res.body.watchSignalMeta).toBeNull()
  })
})
