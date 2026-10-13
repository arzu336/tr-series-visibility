import { describe, it, expect } from 'vitest'
import { toMs, jobState, maskSources } from './jobsStatus.js'

const D = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-09T12:00:00Z')

describe('jobsStatus', () => {
  it('meta değerleri: zaman damgası, gün, ay', () => {
    expect(toMs('1791380000000')).toBe(1791380000000)
    expect(toMs('2026-10-09')).toBe(Date.parse('2026-10-09T00:00:00Z'))
    expect(toMs('2026-10')).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(toMs(null)).toBeNull()
  })

  it('durum: hata > hiç çalışmadı > gecikti > tamam', () => {
    expect(jobState({ lastSuccess: NOW - D, lastAttempt: NOW, lastError: 'zaman aşımı', intervalMs: D }, NOW)).toBe(
      'hata'
    )
    // Hata eski, sonrasında başarılı çalışmış: hata sayılmaz.
    expect(jobState({ lastSuccess: NOW, lastAttempt: NOW - D, lastError: 'eski', intervalMs: D }, NOW)).toBe('tamam')
    expect(jobState({ lastSuccess: null, intervalMs: D }, NOW)).toBe('hiç çalışmadı')
    expect(jobState({ lastSuccess: NOW - 3 * D, intervalMs: D }, NOW)).toBe('gecikti')
    expect(jobState({ lastSuccess: NOW - D, intervalMs: D }, NOW)).toBe('tamam')
  })

  it('hata metninde dış servis adı ve adresi maskelenir', () => {
    expect(maskSources('GDELT hız sınırı (429): https://api.gdeltproject.org/x')).toBe(
      'dış servis hız sınırı (429): dış servis'
    )
    expect(maskSources(null)).toBe(null)
  })
})
