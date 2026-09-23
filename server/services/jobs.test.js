import { describe, it, expect, beforeEach, vi } from 'vitest'
import { startJob, getJob, listJobs, _resetJobsForTests } from './jobs.js'

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => _resetJobsForTests())

describe('startJob / getJob', () => {
  it('hemen queued kayıt döner, sonra running → done olur ve sonucu taşır', async () => {
    let coz
    const { job, existing } = startJob('test', () => new Promise((r) => { coz = r }))
    expect(existing).toBe(false)
    expect(job.status).toBe('queued')
    await tick()
    expect(getJob(job.id).status).toBe('running')
    coz({ ok: true })
    await tick()
    const bitti = getJob(job.id)
    expect(bitti.status).toBe('done')
    expect(bitti.result).toEqual({ ok: true })
    expect(bitti.finishedAt).toBeGreaterThanOrEqual(bitti.startedAt)
  })

  it('runner reddederse failed + hata mesajı; çağırana asla fırlatmaz', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { job } = startJob('test', async () => { throw new Error('GDELT kapalı') })
    await tick()
    await tick()
    expect(getJob(job.id)).toMatchObject({ status: 'failed', error: 'GDELT kapalı', result: null })
    vi.restoreAllMocks()
  })

  it('runner senkron fırlatsa bile failed olur', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { job } = startJob('test', () => { throw new Error('anında') })
    await tick()
    await tick()
    expect(getJob(job.id).status).toBe('failed')
    vi.restoreAllMocks()
  })

  it('update() ilerlemeyi yalnızca running iken yazar ve birleştirir', async () => {
    let coz
    let upd
    const { job } = startJob('test', (update) => { upd = update; return new Promise((r) => { coz = r }) })
    await tick()
    upd({ phase: 'news', done: 3, total: 25 })
    upd({ done: 4, current: 'DE' })
    expect(getJob(job.id).progress).toEqual({ phase: 'news', done: 4, total: 25, current: 'DE' })
    coz(null)
    await tick()
    upd({ done: 99 })
    expect(getJob(job.id).progress.done).toBe(4)
  })

  it('aynı anahtarla süren iş varken ikinci çağrı yeni iş açmaz, mevcut işi döner', async () => {
    let coz
    const runner = vi.fn(() => new Promise((r) => { coz = r }))
    const a = startJob('test', runner, { key: 'series-enrich:1' })
    const b = startJob('test', runner, { key: 'series-enrich:1' })
    expect(b.existing).toBe(true)
    expect(b.job.id).toBe(a.job.id)
    await tick()
    expect(runner).toHaveBeenCalledTimes(1)
    coz('x')
    await tick()
    // İş bittikten sonra aynı anahtar yeni iş açabilir.
    const c = startJob('test', runner, { key: 'series-enrich:1' })
    expect(c.existing).toBe(false)
    expect(c.job.id).not.toBe(a.job.id)
  })

  it('farklı anahtarlar birbirini engellemez', () => {
    const a = startJob('test', () => new Promise(() => {}), { key: 'k1' })
    const b = startJob('test', () => new Promise(() => {}), { key: 'k2' })
    expect(a.job.id).not.toBe(b.job.id)
    expect(listJobs()).toHaveLength(2)
  })

  it('bilinmeyen kimlik null döner', () => {
    expect(getJob('yok')).toBeNull()
  })

  it('sonuç yalnızca done iken, hata yalnızca failed iken dışa açılır', async () => {
    const { job } = startJob('test', () => new Promise(() => {}))
    await tick()
    const j = getJob(job.id)
    expect(j.result).toBeNull()
    expect(j.error).toBeNull()
  })
})
