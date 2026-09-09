import { describe, it, expect, afterEach } from 'vitest'
import { sessionCookieHeader, isSecureRequest } from './auth.js'

// Denetim bulgusu O-3 bir DAĞITIM ENGELİYDİ: `Secure` bayrağı `NODE_ENV === 'production'`
// şartına bağlıydı ve `.env.example` da `NODE_ENV=production` ile geliyordu. Düz HTTP üzerinden
// yayınlanan kurum içi bir kurulumda sunucu 200 dönüyor, tarayıcı `Secure` çerezi HTTP'de
// sessizce atıyor ve HİÇ KİMSE giriş yapamıyordu (tekrar denemeler de giriş hız sınırına
// takılıyordu). Bu dosya, bayrağın bir daha ortam değişkenine bağlanmamasını garanti eder.

const oncekiNodeEnv = process.env.NODE_ENV

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
    // Regresyonun tam senaryosu: bu satır kırmızıya dönerse intranet girişi yine kilitlenir.
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
