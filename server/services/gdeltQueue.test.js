import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// GDELT kuyruğu: 20 sn aralık + öncelik. Ağ yok — undici fetch sahte; zaman sahte.
const cagrilar = vi.hoisted(() => [])
vi.mock('undici', () => ({
  Agent: class {},
  fetch: vi.fn(async (url) => {
    const q = new URL(url).searchParams.get('query')
    cagrilar.push(q)
    return { status: 200, text: async () => JSON.stringify({ articles: [] }) }
  }),
}))
vi.mock('../cache.js', () => ({ getCached: () => null, setCached: () => {} }))

const { fetchNewsArticlesGdelt, GDELT_PRIORITY, gdeltQueueStats } = await import('./gdeltNews.js')

// Kuyruğun "son istek zamanı" modül durumunda yaşar; her test sahte saati bir saat ileri kurar
// ki önceki testin ileri alınmış saati yeni testte "geleceğe" düşüp aralığı uzatmasın.
let taban = Date.now()
beforeEach(() => {
  cagrilar.length = 0
  taban += 60 * 60 * 1000
  vi.useFakeTimers()
  vi.setSystemTime(taban)
})
afterEach(() => {
  vi.useRealTimers()
})

async function hepsiniAkit(adim = 21_000, tur = 10) {
  for (let i = 0; i < tur; i++) await vi.advanceTimersByTimeAsync(adim)
}

describe('GDELT kuyruğu — öncelik', () => {
  it('etkileşimli istek, bekleyen arka plan isteklerinin ÖNÜNE geçer', async () => {
    const sozler = [
      fetchNewsArticlesGdelt('arka-1', 'DE'),
      fetchNewsArticlesGdelt('arka-2', 'DE'),
      fetchNewsArticlesGdelt('arka-3', 'DE'),
    ]
    await vi.advanceTimersByTimeAsync(0) // ilk istek hemen çalışır
    sozler.push(fetchNewsArticlesGdelt('kullanici', 'DE', { priority: GDELT_PRIORITY.INTERACTIVE }))
    expect(gdeltQueueStats().interactiveWaiting).toBe(1)

    await hepsiniAkit()
    await Promise.all(sozler)

    const sirayla = cagrilar.map((q) => q.split('"')[1])
    // arka-1 zaten çalışıyordu; kullanıcı isteği arka-2 ve arka-3'ün önüne geçti.
    expect(sirayla).toEqual(['arka-1', 'kullanici', 'arka-2', 'arka-3'])
    expect(gdeltQueueStats()).toEqual({ waiting: 0, interactiveWaiting: 0, running: false })
  })

  it('aynı öncelikte FIFO korunur', async () => {
    const sozler = ['a', 'b', 'c'].map((q) => fetchNewsArticlesGdelt(q, 'FR'))
    await hepsiniAkit()
    await Promise.all(sozler)
    expect(cagrilar.map((q) => q.split('"')[1])).toEqual(['a', 'b', 'c'])
  })

  it('istekler arasında en az 20 sn bırakılır', async () => {
    const sozler = [fetchNewsArticlesGdelt('x', 'DE'), fetchNewsArticlesGdelt('y', 'DE')]
    await vi.advanceTimersByTimeAsync(0)
    expect(cagrilar).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(19_000)
    expect(cagrilar).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(cagrilar).toHaveLength(2)
    await hepsiniAkit()
    await Promise.all(sozler)
  })

  it('desteklenmeyen ülke kuyruğa hiç girmez', async () => {
    const sonuc = await fetchNewsArticlesGdelt('x', 'XX')
    expect(sonuc.unsupported).toBe(true)
    expect(cagrilar).toHaveLength(0)
  })
})
