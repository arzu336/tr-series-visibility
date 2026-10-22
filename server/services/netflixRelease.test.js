import { describe, it, expect } from 'vitest'
import db from '../db.js'
import { isNewerRelease, fetchNetflixReleaseIfNeeded } from './netflixRelease.js'

const json = (body, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  json: async () => body,
})
const bytes = (buf) => ({
  ok: true,
  status: 200,
  headers: { get: (k) => (k === 'content-length' ? String(buf.length) : null) },
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
})

describe('netflixRelease — yeni hafta kararı', () => {
  it('tam olmayan ya da haftasız özet yeni sayılmaz; hafta karşılaştırması metinsel', () => {
    expect(isNewerRelease(null, null)).toBe(false)
    expect(isNewerRelease({ complete: false, last_week: '2026-10-18' }, null)).toBe(false)
    expect(isNewerRelease({ complete: true, last_week: '2026-10-18' }, null)).toBe(true)
    expect(isNewerRelease({ complete: true, last_week: '2026-10-18' }, '2026-10-11')).toBe(true)
    expect(isNewerRelease({ complete: true, last_week: '2026-10-18' }, '2026-10-18')).toBe(false)
  })
})

describe('netflixRelease — alma akışı', () => {
  const clear = () =>
    db.prepare("DELETE FROM meta WHERE key IN ('netflixReleaseCheckedAt', 'netflixReleaseWeek')").run()

  it('sürüm yoksa sessizce atlanır; aynı hafta tekrar indirilmez; yeni haftada indirip içe alır', async () => {
    clear()
    const yok = await fetchNetflixReleaseIfNeeded({ force: true, fetchFn: async () => json({}, 404) })
    expect(yok).toMatchObject({ status: 'skipped' })

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('netflixReleaseWeek', '2026-10-18')").run()
    const ayni = await fetchNetflixReleaseIfNeeded({
      force: true,
      fetchFn: async () => json({ complete: true, last_week: '2026-10-18' }),
    })
    expect(ayni.status).toBe('skipped')

    const data = Buffer.from('week\tcountry\n2026-10-25\tTR')
    const calls = []
    const exec = (bin, args, opts, cb) => {
      calls.push(args)
      cb(null, 'RESULT_JSON {"ok":true}', '')
    }
    const ok = await fetchNetflixReleaseIfNeeded({
      force: true,
      exec,
      fetchFn: async (url) =>
        url.endsWith('.json')
          ? json({ complete: true, last_week: '2026-10-25', content_length: data.length })
          : bytes(data),
    })
    expect(ok).toMatchObject({ status: 'ok', week: '2026-10-25', bytes: data.length })
    expect(calls[0][0]).toBe('netflix_import_artifact.py')
    expect(db.prepare("SELECT value FROM meta WHERE key = 'netflixReleaseWeek'").get().value).toBe('2026-10-25')

    // İçe alma başarısızsa hafta kaydedilmez
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('netflixReleaseWeek', '2026-10-18')").run()
    const fail = await fetchNetflixReleaseIfNeeded({
      force: true,
      exec: (b, a, o, cb) => cb(Object.assign(new Error('bozuk'), { code: 1 }), '', 'Dosya tam değil'),
      fetchFn: async (url) =>
        url.endsWith('.json')
          ? json({ complete: true, last_week: '2026-11-01', content_length: data.length })
          : bytes(data),
    })
    expect(fail.status).toBe('failed')
    expect(db.prepare("SELECT value FROM meta WHERE key = 'netflixReleaseWeek'").get().value).toBe('2026-10-18')
    clear()
  })
})
