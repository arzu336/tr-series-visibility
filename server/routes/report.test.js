import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'

// Route + yetki testi: gerçek Express app (dinlemeden), test DB (APP_DB_PATH), üç erişim düzeyi.
// Rapor üreticisi sahte — TMDB/World Bank'a çıkılmaz; kapı davranışı (direktif elemesi) gerçek.

process.env.APP_PASSWORD = 'rapor-test-sifresi-12'
process.env.ADMIN_EMAIL = 'rapor-admin@example.com'

const sahteRapor = (iso2) => {
  const bolum = (key, body) => ({ key, title: key, note: 'not', ...body })
  const sections = {}
  for (const k of [
    'scores',
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
  sections.scores = bolum('scores', { status: 'hesaplandi', data: { score: 500 } })
  sections.findings = bolum('findings', {
    status: 'hesaplandi',
    data: {
      items: [
        { text: 'Toplam görünürlükte 137 ülke arasında 7. sırada.', basis: 'ranking' },
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

describe('GET /api/report/country/:iso2 — yetki matrisi', () => {
  it('oturumsuz istek 401', async () => {
    const res = await request(app).get('/api/report/country/DE?profile=executive')
    expect(res.status).toBe(401)
  })

  it('viewer: executive 200, marketing 403, producer 403', async () => {
    expect((await viewer.get('/api/report/country/DE?profile=executive')).status).toBe(200)
    expect((await viewer.get('/api/report/country/DE?profile=marketing')).status).toBe(403)
    expect((await viewer.get('/api/report/country/DE?profile=producer')).status).toBe(403)
  })

  it('analyst: marketing 200, producer 403', async () => {
    expect((await analyst.get('/api/report/country/DE?profile=marketing')).status).toBe(200)
    const res = await analyst.get('/api/report/country/DE?profile=producer')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/admin/)
  })

  it('admin: producer 200 ve yalnızca producer bölümleri döner', async () => {
    const res = await admin.get('/api/report/country/DE?profile=producer')
    expect(res.status).toBe(200)
    expect(res.body.profile).toBe('producer')
    expect(Object.keys(res.body.sections)).toEqual([
      'scores',
      'availability',
      'netflixHistory',
      'gapAnalysis',
      'tourismSignal',
    ])
    expect(res.body.availableProfiles).toEqual(['executive', 'marketing', 'producer'])
  })

  it('profil verilmezse executive varsayılır', async () => {
    const res = await viewer.get('/api/report/country/DE')
    expect(res.status).toBe(200)
    expect(res.body.profile).toBe('executive')
    expect(res.body.availableProfiles).toEqual(['executive'])
  })
})

describe('GET /api/report/country/:iso2 — doğrulama ve kapı', () => {
  it('geçersiz ISO2 400, bilinmeyen profil 400', async () => {
    expect((await admin.get('/api/report/country/XYZ?profile=executive')).status).toBe(400)
    const res = await admin.get('/api/report/country/DE?profile=ceo')
    expect(res.status).toBe(400)
    expect(res.body.profiles).toContain('executive')
  })

  it('ISO2 normalize edilir ve üretici o kodla çağrılır', async () => {
    const res = await admin.get('/api/report/country/de?profile=executive')
    expect(res.status).toBe(200)
    expect(res.body.iso2).toBe('DE')
    expect(vi.mocked(buildCountryReport)).toHaveBeenLastCalledWith('DE', { useCache: true })
  })

  it('fresh=1 önbelleği atlar', async () => {
    await admin.get('/api/report/country/DE?profile=executive&fresh=1')
    expect(vi.mocked(buildCountryReport)).toHaveBeenLastCalledWith('DE', { useCache: false })
  })

  it('direktif içeren bulgu yanıttan elenir (iddia kapısı, istisna yok)', async () => {
    const res = await viewer.get('/api/report/country/DE?profile=executive')
    const metinler = res.body.sections.findings.data.items.map((i) => i.text)
    expect(metinler).toEqual(['Toplam görünürlükte 137 ülke arasında 7. sırada.'])
  })
})

describe('GET /api/report/profiles', () => {
  it('kullanıcının erişebildiği profilleri işaretler', async () => {
    const res = await analyst.get('/api/report/profiles')
    expect(res.status).toBe(200)
    expect(res.body.profiles.map((p) => [p.id, p.allowed])).toEqual([
      ['executive', true],
      ['marketing', true],
      ['producer', false],
    ])
  })
})
