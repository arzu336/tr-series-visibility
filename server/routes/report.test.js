import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'

// Route testi: gerçek Express app (dinlemeden), test DB (APP_DB_PATH), üç erişim düzeyi — tek ortak rapor.
// Rapor üreticisi sahte — TMDB/World Bank'a çıkılmaz; kapı davranışı (direktif elemesi) gerçek.

process.env.APP_PASSWORD = 'rapor-test-sifresi-12'
process.env.ADMIN_EMAIL = 'rapor-admin@example.com'

const sahteRapor = (iso2) => {
  const bolum = (key, body) => ({ key, title: key, note: 'not', ...body })
  const sections = {}
  for (const k of [
    'scores',
    'platformLists',
    'ranking',
    'trend',
    'findings',
    'topSeries',
    'themes',
    'searchTrend',
    'pressTone',
    'highlightedSeries',
    'availability',
    'netflixHistory',
    'gapAnalysis',
    'tourismSignal',
  ]) {
    sections[k] = bolum(k, { status: 'hesaplanamaz', reason: 'sahte' })
  }
  sections.scores = bolum('scores', {
    status: 'hesaplandi',
    data: { level: 'yüksek', access: { seriesCount: 40, platformCount: 5 }, warnings: [] },
  })
  sections.topSeries = bolum('topSeries', {
    status: 'hesaplandi',
    data: {
      entries: [
        { tmdbId: 1, name: 'Uzak Şehir', compositeScore: 50, evidence: [] },
        { text: 'Bu pazarda tanıtım faaliyetleri artırılmalı.' },
      ],
    },
  })
  sections.findings = bolum('findings', {
    status: 'hesaplandi',
    data: {
      items: [
        { text: 'İzlenme düzeyi "yüksek": izlenme sinyali hesaplanan 111 ülke arasında 7. sırada.', basis: 'ranking' },
        { text: 'Bu pazarda tanıtım faaliyetleri artırılmalı.', basis: 'sizinti' },
      ],
    },
  })
  return {
    iso2,
    generatedAt: 'x',
    isTracked: true,
    dataCutoffs: {},
    dataGaps: [],
    sections,
    contract: 'ulke-raporu-v1',
  }
}

vi.mock('../services/countryReport.js', async (orig) => {
  const gercek = await orig()
  return { ...gercek, buildCountryReport: vi.fn(async (iso2) => sahteRapor(iso2)) }
})

const { app } = await import('../app.js')
const { registerUser, findUserByEmail, listUsers, setUserStatus, setUserAccessLevel, resetUserPassword } =
  await import('../users.js')
const { buildCountryReport } = await import('../services/countryReport.js')

// Test DB'de önceki koşulardan yönetici kalmış olabilir (ensureBootstrapAdmin o zaman yeni admin
// açmaz). Var olan herhangi bir yöneticinin şifresi sıfırlanıp onunla girilir — kurulum sırasından
// bağımsız, idempotent.
function yoneticiHazirla() {
  const admin = findUserByEmail(process.env.ADMIN_EMAIL) || listUsers().find((u) => u.isAdmin)
  if (!admin) throw new Error("test DB'de yönetici yok; ensureBootstrapAdmin çalışmadı")
  const sifre = resetUserPassword(admin.id)
  return { admin, sifre }
}

function kullaniciHazirla(email, accessLevel, adminId) {
  if (!findUserByEmail(email)) {
    registerUser({ name: `Test ${accessLevel}`, email, role: 'test', password: 'test-sifre-123' })
  }
  const u = findUserByEmail(email)
  setUserStatus(u.id, 'approved', adminId)
  setUserAccessLevel(u.id, accessLevel, adminId)
  const sifre = resetUserPassword(u.id)
  return { user: u, sifre }
}

async function girisYap(email, password) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email, password })
  expect(res.status, `${email} girişi`).toBe(200)
  return agent
}

let viewer, analyst, admin

beforeAll(async () => {
  const { admin: yonetici, sifre: yoneticiSifresi } = yoneticiHazirla()
  const v = kullaniciHazirla('rapor-viewer@example.com', 'viewer', yonetici.id)
  const a = kullaniciHazirla('rapor-analyst@example.com', 'analyst', yonetici.id)
  viewer = await girisYap('rapor-viewer@example.com', v.sifre)
  analyst = await girisYap('rapor-analyst@example.com', a.sifre)
  admin = await girisYap(yonetici.email, yoneticiSifresi)
})

describe('GET /api/report/country/:iso2 — ülke brifingi', () => {
  it('oturumsuz istek 401', async () => {
    const res = await request(app).get('/api/report/country/DE')
    expect(res.status).toBe(401)
  })

  it('her erişim düzeyi aynı brifingi alır: özet ve başlıklar', async () => {
    const yanitlar = await Promise.all([viewer, analyst, admin].map((a) => a.get('/api/report/country/DE')))
    for (const res of yanitlar) {
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Ülke brifingi')
      expect(res.body.contract).toBe('ulke-brifingi-v1')
      expect(res.body.summary.kpis.map((k) => k.key)).toEqual(['level', 'ranked', 'available', 'reading'])
      expect(res.body.chapters.map((c) => c.key)).toEqual(['izleniyor'])
      expect(res.body.appendix).toBeUndefined()
      expect(res.body.profile).toBeUndefined()
    }
    expect(yanitlar[0].body).toEqual(yanitlar[2].body)
  })

  it('eski profil parametresi yok sayılır', async () => {
    expect((await viewer.get('/api/report/country/DE?profile=producer')).status).toBe(200)
  })
})

describe('GET /api/report/country/:iso2 — doğrulama ve kapı', () => {
  it('geçersiz ISO2 400', async () => {
    expect((await admin.get('/api/report/country/XYZ')).status).toBe(400)
  })

  it('ISO2 normalize edilir ve üretici o kodla çağrılır', async () => {
    const res = await admin.get('/api/report/country/de')
    expect(res.status).toBe(200)
    expect(res.body.iso2).toBe('DE')
    expect(vi.mocked(buildCountryReport)).toHaveBeenLastCalledWith('DE', { useCache: true })
  })

  it('fresh=1 önbelleği atlar', async () => {
    await admin.get('/api/report/country/DE?fresh=1')
    expect(vi.mocked(buildCountryReport)).toHaveBeenLastCalledWith('DE', { useCache: false })
  })

  it('direktif içeren metin brifingin başlıklarından elenir (iddia kapısı, istisna yok)', async () => {
    const res = await viewer.get('/api/report/country/DE')
    const top = res.body.chapters.find((c) => c.key === 'izleniyor').sections.find((x) => x.key === 'topSeries')
    expect(top.data.entries.map((e) => e.name ?? e.text)).toEqual(['Uzak Şehir'])
  })

  it('profil listesi ucu kaldırıldı', async () => {
    expect((await admin.get('/api/report/profiles')).status).toBe(404)
  })
})

describe('GET /api/report/global — küresel görünüm', () => {
  it('yalnızca yönetici: viewer ve analyst 403', async () => {
    expect((await viewer.get('/api/report/global')).status).toBe(403)
    expect((await analyst.get('/api/report/global')).status).toBe(403)
  })

  it('eski etki analizi uçları kaldırıldı (yönetici için de 404)', async () => {
    for (const u of [
      '/api/impact',
      '/api/impact/cultural',
      '/api/impact/tourism',
      '/api/impact/export',
      '/api/impact/country-summary/DE',
    ])
      expect((await admin.get(u)).status, u).toBe(404)
  })
})
