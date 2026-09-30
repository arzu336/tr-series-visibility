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
  isReytingtvSyncDue,
  runReytingtvBackfill,
  runReytingtvSyncIfNeeded,
  META_LAST_SUCCESS,
  META_LAST_ATTEMPT,
  META_LAST_ERROR,
  INTERVAL_MS,
  RETRY_BACKOFF_MS,
  SCRIPT,
  CATCH_UP_DAYS,
} = await import('./reytingtvRunner.js')

const SAAT = 60 * 60 * 1000
const NOW = new Date(2026, 8, 30, 12, 0).getTime()
const OZET = '{"status": "ok", "chart_entries_written": 30, "days": 1}'

function sahteExec({ fail = false, killed = false } = {}) {
  const fn = vi.fn((bin, args, opts, cb) => {
    fn.cagrilar.push({ bin, args, opts })
    setTimeout(() => {
      if (fail) cb(Object.assign(new Error('patladı'), { code: 1, killed }), 'RESULT_JSON ' + OZET, 'hata')
      else cb(null, 'INFO satır\nRESULT_JSON ' + OZET + '\n', '')
    }, 0)
  })
  fn.cagrilar = []
  return fn
}

beforeEach(() => metaDeposu.clear())

describe('isReytingtvSyncDue — günlük', () => {
  it('hiç başarı yoksa sıradadır', () => {
    expect(isReytingtvSyncDue({ now: NOW })).toBe(true)
  })
  it('24 saatten yeni başarı varsa değil; 24 saat geçtiyse evet', () => {
    expect(isReytingtvSyncDue({ now: NOW, lastSuccessAt: NOW - 23 * SAAT })).toBe(false)
    expect(isReytingtvSyncDue({ now: NOW, lastSuccessAt: NOW - INTERVAL_MS })).toBe(true)
  })
  it('başarısız denemeden sonra 6 saat beklenir', () => {
    expect(isReytingtvSyncDue({ now: NOW, lastAttemptAt: NOW - 2 * SAAT })).toBe(false)
    expect(isReytingtvSyncDue({ now: NOW, lastAttemptAt: NOW - RETRY_BACKOFF_MS })).toBe(true)
  })
})

describe('runReytingtvBackfill / runReytingtvSyncIfNeeded', () => {
  it('betiği --days ile çağırır ve RESULT_JSON özetini döner', async () => {
    const exec = sahteExec()
    const r = await runReytingtvBackfill({ exec, pythonBin: 'py' })
    expect(r.status).toBe('ok')
    expect(r.summary).toBe(OZET)
    expect(exec.cagrilar[0].args).toEqual([SCRIPT, '--days', String(CATCH_UP_DAYS)])
    expect(exec.cagrilar[0].opts.env.PYTHONUTF8).toBe('1')
  })
  it('başarıda meta yazılır, hatada hata metası yazılır ve fırlatmaz', async () => {
    let r = await runReytingtvSyncIfNeeded({ exec: sahteExec(), now: NOW })
    expect(r.status).toBe('ok')
    expect(metaDeposu.get(META_LAST_SUCCESS)).toBe(String(NOW))
    metaDeposu.clear()
    r = await runReytingtvSyncIfNeeded({ exec: sahteExec({ fail: true }), now: NOW })
    expect(r.status).toBe('failed')
    expect(metaDeposu.get(META_LAST_ATTEMPT)).toBe(String(NOW))
    expect(metaDeposu.get(META_LAST_ERROR)).toMatch(/çıkış kodu 1/)
    expect(metaDeposu.has(META_LAST_SUCCESS)).toBe(false)
  })
  it('sırası gelmemişse null döner ve alt süreç çalıştırmaz', async () => {
    metaDeposu.set(META_LAST_SUCCESS, String(NOW - SAAT))
    const exec = sahteExec()
    expect(await runReytingtvSyncIfNeeded({ exec, now: NOW })).toBeNull()
    expect(exec.cagrilar).toHaveLength(0)
  })
})
