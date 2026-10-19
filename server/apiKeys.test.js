import { describe, it, expect } from 'vitest'
import request from 'supertest'
import db from './db.js'
import {
  createApiKey,
  resolveApiKey,
  revokeApiKey,
  deleteApiKey,
  hashApiKey,
  apiKeyFromHeaders,
  apiKeyUser,
} from './apiKeys.js'

const { app } = await import('./app.js')

describe('apiKeys — oluşturma ve çözme', () => {
  it('düz metin yalnızca oluşturma dönüşünde; veritabanında özet; iptal sonrası çözülmez', () => {
    const k = createApiKey({ name: 'Test sistemi', createdBy: 'u1' })
    expect(k.key).toMatch(/^gp_[A-Za-z0-9_-]{40,}$/)
    expect(k.prefix).toBe(k.key.slice(0, 11))
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(k.id)
    expect(row.key_hash).toBe(hashApiKey(k.key))
    expect(JSON.stringify(row)).not.toContain(k.key)
    expect(resolveApiKey(k.key)?.id).toBe(k.id)
    expect(resolveApiKey(`${k.key}x`)).toBeNull()
    expect(resolveApiKey('gp_kisa')).toBeNull()
    expect(revokeApiKey(k.id)).toBe(true)
    expect(resolveApiKey(k.key)).toBeNull()
    expect(revokeApiKey(k.id)).toBe(false)
    expect(deleteApiKey(k.id)).toBe(true)
  })

  it('ad doğrulaması ve başlık ayrıştırma', () => {
    expect(() => createApiKey({ name: 'a' })).toThrow()
    expect(apiKeyFromHeaders({ 'x-api-key': 'gp_abc' })).toBe('gp_abc')
    expect(apiKeyFromHeaders({ authorization: 'Bearer gp_abc' })).toBe('gp_abc')
    expect(apiKeyFromHeaders({ authorization: 'Basic xyz' })).toBeNull()
    expect(apiKeyUser({ id: '1', name: 'X' })).toMatchObject({
      id: 'apikey:1',
      accessLevel: 'analyst',
      isAdmin: false,
      apiKey: true,
    })
  })
})

describe('apiKeys — oturum duvarı', () => {
  it('geçerli anahtarla okuma geçer, yazma ve yönetici uçları 403, iptal edilince 401', async () => {
    const k = createApiKey({ name: 'Duvar testi' })
    const ok = await request(app).get('/api/series/66017/tv').set('X-API-Key', k.key)
    expect(ok.status).toBe(200)
    const read = await request(app).get('/api/admin/api-keys').set('X-API-Key', k.key)
    expect(read.status).toBe(403)
    const write = await request(app).post('/api/tv/run').set('X-API-Key', k.key)
    expect(write.status).toBe(403)
    const bad = await request(app)
      .get('/api/series/66017/tv')
      .set('Authorization', 'Bearer gp_yanlis_anahtar_000000000000')
    expect(bad.status).toBe(401)
    revokeApiKey(k.id)
    const after = await request(app).get('/api/series/66017/tv').set('X-API-Key', k.key)
    expect(after.status).toBe(401)
    deleteApiKey(k.id)
  })
})
