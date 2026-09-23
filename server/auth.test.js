import { describe, it, expect, afterEach } from 'vitest'
import db from './db.js'
import {
  sessionCookieHeader,
  isSecureRequest,
  createSession,
  getSessionUserId,
  deleteSession,
  hashSessionToken,
  migrateLegacyPlaintextSessions,
  sessionRateLimitKey,
  parseCookies,
} from './auth.js'

const oncekiNodeEnv = process.env.NODE_ENV

describe('oturum token özeti', () => {
  const tokenSatiri = db.prepare('SELECT token, user_id FROM sessions WHERE user_id = ?')

  it('veritabanında ham token DEĞİL, SHA-256 özeti durur; ham token ile çözülür', () => {
    const token = createSession('u-hash-1')
    const satir = tokenSatiri.get('u-hash-1')
    expect(satir.token).not.toBe(token)
    expect(satir.token).toBe(hashSessionToken(token))
    expect(satir.token).toHaveLength(64)
    expect(getSessionUserId(token)).toBe('u-hash-1')
    deleteSession(token)
    expect(getSessionUserId(token)).toBeNull()
  })

  it('özetin kendisi çerez olarak kullanılamaz (sızan DB satırı oturum açmaz)', () => {
    const token = createSession('u-hash-2')
    expect(getSessionUserId(hashSessionToken(token))).toBeNull()
    deleteSession(token)
  })

  it('eski düz metin satırlar geçişte özetlenir ve çalışmaya devam eder', () => {
    const eskiToken = 'a'.repeat(48)
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(eskiToken, 'u-legacy', Date.now() + 60_000)
    expect(getSessionUserId(eskiToken)).toBeNull() // özet aranıyor, düz metin bulunmaz
    expect(migrateLegacyPlaintextSessions()).toBe(1)
    expect(getSessionUserId(eskiToken)).toBe('u-legacy')
    expect(migrateLegacyPlaintextSessions()).toBe(0) // idempotent
    deleteSession(eskiToken)
  })

  it('hız sınırı anahtarı ham token içermez', () => {
    const token = 'b'.repeat(48)
    const anahtar = sessionRateLimitKey(token)
    expect(anahtar).not.toContain(token)
    expect(anahtar).toMatch(/^sess:[0-9a-f]{24}$/)
  })
})

describe('parseCookies', () => {
  it('normal çerezleri ayrıştırır ve yüzde kodunu çözer', () => {
    expect(parseCookies('a=1; gp_session=abc; x=%C3%BC')).toEqual({ a: '1', gp_session: 'abc', x: 'ü' })
  })

  it('bozuk yüzde kodlaması FIRLATMAZ, ham değer döner', () => {
    expect(() => parseCookies('gp_session=%E0%A4%A; ok=1')).not.toThrow()
    expect(parseCookies('gp_session=%E0%A4%A; ok=1')).toEqual({ gp_session: '%E0%A4%A', ok: '1' })
  })

  it('boş/eksik başlıkta boş nesne', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies('=x; ;')).toEqual({})
  })
})

afterEach(() => {
  process.env.NODE_ENV = oncekiNodeEnv
})

function istek({ secure = false, proto } = {}) {
  return { secure, headers: proto === undefined ? {} : { 'x-forwarded-proto': proto } }
}

describe('isSecureRequest', () => {
  it('doğrudan HTTPS isteğini tanır', () => {
    expect(isSecureRequest(istek({ secure: true }))).toBe(true)
  })

  it('TLS sonlandıran proxy arkasını X-Forwarded-Proto ile tanır', () => {
    expect(isSecureRequest(istek({ proto: 'https' }))).toBe(true)
  })

  it('proxy zincirinde ilk değeri (istemciye en yakın) dikkate alır', () => {
    expect(isSecureRequest(istek({ proto: 'https, http' }))).toBe(true)
    expect(isSecureRequest(istek({ proto: 'http, https' }))).toBe(false)
  })

  it('düz HTTP için false döner', () => {
    expect(isSecureRequest(istek())).toBe(false)
    expect(isSecureRequest(istek({ proto: 'http' }))).toBe(false)
  })

  it('req verilmezse güvenli varsayım yapmaz', () => {
    expect(isSecureRequest(undefined)).toBe(false)
  })
})

describe('sessionCookieHeader — Secure bayrağı (O-3)', () => {
  it('NODE_ENV=production OLSA BİLE düz HTTP isteğine Secure eklemez', () => {
    process.env.NODE_ENV = 'production'
    expect(sessionCookieHeader('t', 60, istek())).not.toContain('Secure')
  })

  it('NODE_ENV ayarlı olmasa bile HTTPS isteğine Secure ekler', () => {
    process.env.NODE_ENV = ''
    expect(sessionCookieHeader('t', 60, istek({ secure: true }))).toContain('Secure')
    expect(sessionCookieHeader('t', 60, istek({ proto: 'https' }))).toContain('Secure')
  })

  it('temel çerez nitelikleri her durumda korunur', () => {
    const header = sessionCookieHeader('abc', 604800, istek({ secure: true }))
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Path=/')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=604800')
  })
})
