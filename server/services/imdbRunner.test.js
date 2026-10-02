import { describe, it, expect, vi, beforeEach } from 'vitest'

const metaDeposu = new Map()

vi.mock('../db.js', () => ({
  default: {
    prepare: () => ({
      get: (key) => (metaDeposu.has(key) ? { value: metaDeposu.get(key) } : undefined),
      run: (key, value) => metaDeposu.set(key, value),
      all: () => [],
    }),
  },
}))

const {
  isImdbSyncDue,
  runImdbSyncIfNeeded,
  META_LAST_SUCCESS,
  META_LAST_ATTEMPT,
  META_LAST_ERROR,
  INTERVAL_MS,
  RETRY_BACKOFF_MS,
  SCRIPT,
} = await import('./imdbRunner.js')

const SAAT = 60 * 60 * 1000
const NOW = new Date(2026, 9, 2, 12, 0).getTime()
const OZET = '{"status": "ok", "rated": 434}'

function sahteExec({ fail = false } = {}) {
  const fn = vi.fn((bin, args, opts, cb) => {
    fn.cagrilar.push({ bin, args })
    setTimeout(() => {
      if (fail) cb(Object.assign(new Error('patladı'), { code: 1 }), '', 'hata')
      else cb(null, 'INFO\nRESULT_JSON ' + OZET + '\n', '')
    }, 0)
  })
  fn.cagrilar = []
  return fn
}

beforeEach(() => {
  metaDeposu.clear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isImdbSyncDue — günlük kapı', () => {
  it('hiç çalışmadıysa hemen; 24 saat dolmadan tekrar çalışmaz', () => {
    expect(isImdbSyncDue({ now: NOW })).toBe(true)
    expect(isImdbSyncDue({ now: NOW, lastSuccessAt: NOW - 23 * SAAT })).toBe(false)
    expect(isImdbSyncDue({ now: NOW, lastSuccessAt: NOW - INTERVAL_MS })).toBe(true)
  })

  it('başarısız denemeden sonra geri çekilme süresi beklenir', () => {
    expect(isImdbSyncDue({ now: NOW, lastAttemptAt: NOW - 1 * SAAT })).toBe(false)
    expect(isImdbSyncDue({ now: NOW, lastAttemptAt: NOW - RETRY_BACKOFF_MS })).toBe(true)
  })
})

describe('runImdbSyncIfNeeded', () => {
  it('başarıda özet ve zaman damgası yazılır', async () => {
    const exec = sahteExec()
    const sonuc = await runImdbSyncIfNeeded({ now: NOW, exec })
    expect(exec.cagrilar[0].args).toEqual([SCRIPT])
    expect(sonuc).toMatchObject({ status: 'ok', summary: OZET })
    expect(metaDeposu.get(META_LAST_SUCCESS)).toBe(String(NOW))
    expect(metaDeposu.get(META_LAST_ATTEMPT)).toBe(String(NOW))
    expect(await runImdbSyncIfNeeded({ now: NOW + SAAT, exec })).toBeNull()
  })

  it('hatada başarı zamanı yazılmaz, hata kaydedilir', async () => {
    const sonuc = await runImdbSyncIfNeeded({ now: NOW, exec: sahteExec({ fail: true }) })
    expect(sonuc.status).toBe('failed')
    expect(metaDeposu.has(META_LAST_SUCCESS)).toBe(false)
    expect(metaDeposu.get(META_LAST_ERROR)).toMatch(/çıkış kodu 1/)
  })
})
