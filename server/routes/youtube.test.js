import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import request from 'supertest'

// YouTube bağlantı uçları: yalnızca yönetici; yapılandırma eksikse Google'a gidilmez; dönüşte durum doğrulanır.

process.env.APP_PASSWORD = 'youtube-test-sifresi-12'
process.env.ADMIN_EMAIL = 'youtube-admin@example.com'

const { app } = await import('../app.js')
const { registerUser, findUserByEmail, listUsers, setUserStatus, resetUserPassword } = await import('../users.js')

const ENV_KEYS = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI', 'YOUTUBE_TOKEN_KEY']

async function girisYap(email, password) {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/login').send({ email, password })
  expect(res.status).toBe(200)
  return agent
}

let admin, viewer

beforeAll(async () => {
  const yonetici = findUserByEmail(process.env.ADMIN_EMAIL) || listUsers().find((u) => u.isAdmin)
  admin = await girisYap(yonetici.email, resetUserPassword(yonetici.id))
  const email = 'youtube-viewer@example.com'
  if (!findUserByEmail(email)) registerUser({ name: 'İzleyici', email, role: 'test', password: 'test-sifre-123' })
  const u = findUserByEmail(email)
  setUserStatus(u.id, 'approved', yonetici.id)
  viewer = await girisYap(email, resetUserPassword(u.id))
})

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('YouTube bağlantı uçları', () => {
  it('yönetici olmayan kullanıcı erişemez', async () => {
    expect((await viewer.get('/api/youtube/status')).status).toBe(403)
    expect((await viewer.get('/api/youtube/connect')).status).toBe(403)
  })

  it('yapılandırma eksikse durum eksikleri söyler, bağlanma Google’a yönlendirmez', async () => {
    const s = await admin.get('/api/youtube/status')
    expect(s.status).toBe(200)
    expect(s.body).toMatchObject({ configured: false, channels: [] })
    expect(s.body.missing).toEqual(ENV_KEYS)
    expect((await admin.get('/api/youtube/connect')).status).toBe(400)
  })

  it('yapılandırma tamamsa Google onay ekranına yönlendirir; dönüşte bilinmeyen durum reddedilir', async () => {
    process.env.YOUTUBE_CLIENT_ID = 'istemci'
    process.env.YOUTUBE_CLIENT_SECRET = 'gizli'
    process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:5173/api/youtube/oauth/callback'
    process.env.YOUTUBE_TOKEN_KEY = 'anahtar'
    const c = await admin.get('/api/youtube/connect')
    expect(c.status).toBe(302)
    expect(c.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    const geri = await admin.get('/api/youtube/oauth/callback?code=x&state=sahte')
    expect(geri.status).toBe(302)
    expect(geri.headers.location).toMatch(/yonetim=youtube&youtube=hata/)
    const iptal = await admin.get('/api/youtube/oauth/callback?error=access_denied')
    expect(iptal.headers.location).toMatch(/youtube=iptal/)
  })

  it('bağlı olmayan kanal eşitlenemez ve kaldırılamaz', async () => {
    expect((await admin.post('/api/youtube/channels/UCyok/sync')).status).toBe(404)
    expect((await admin.delete('/api/youtube/channels/UCyok')).status).toBe(404)
  })
})
