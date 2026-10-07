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

const { fetchNewsArticlesGdelt, GDELT_PRIORITY, gdeltQueueStats, TURKISH_CONTEXT, gdeltGapMs } =
  await import('./gdeltNews.js')
const { fetch: sahteFetch } = await import('undici')

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
    const sozler = ['dizi-a', 'dizi-b', 'dizi-c'].map((q) => fetchNewsArticlesGdelt(q, 'FR'))
    await hepsiniAkit()
    await Promise.all(sozler)
    expect(cagrilar.map((q) => q.split('"')[1])).toEqual(['dizi-a', 'dizi-b', 'dizi-c'])
  })

  it('istekler arasında en az 20 sn bırakılır', async () => {
    const sozler = [fetchNewsArticlesGdelt('dizi-x', 'DE'), fetchNewsArticlesGdelt('dizi-y', 'DE')]
    await vi.advanceTimersByTimeAsync(0)
    expect(cagrilar).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(19_000)
    expect(cagrilar).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(cagrilar).toHaveLength(2)
    await hepsiniAkit()
    await Promise.all(sozler)
  })

  it('hız sınırı (429) aralığı ikiye katlar, başarılı yanıt yeniden 20 sn aralığa indirir', async () => {
    vi.mocked(sahteFetch).mockImplementationOnce(async (url) => {
      cagrilar.push(new URL(url).searchParams.get('query'))
      return { status: 429, text: async () => 'Please limit requests to one every 5 seconds' }
    })
    const soz = fetchNewsArticlesGdelt('limitli', 'DE')
    await vi.advanceTimersByTimeAsync(0)
    expect(cagrilar).toHaveLength(1)
    expect(gdeltGapMs()).toBe(40_000)
    await vi.advanceTimersByTimeAsync(30_000) // eski sabit 20 sn'de yeniden denenirdi
    expect(cagrilar).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(cagrilar).toHaveLength(2)
    await hepsiniAkit()
    await soz
    expect(gdeltGapMs()).toBe(20_000)
  })

  it('desteklenmeyen ülke kuyruğa hiç girmez', async () => {
    const sonuc = await fetchNewsArticlesGdelt('x', 'XX')
    expect(sonuc.unsupported).toBe(true)
    expect(cagrilar).toHaveLength(0)
  })
})

describe('GDELT sorgusu — İngilizce ad ve bağlam koşulu', () => {
  it('bağlam verilince ad grubunun ardına eklenir; ülke filtresi sonda', async () => {
    const soz = fetchNewsArticlesGdelt(['Kızılcık Şerbeti', 'Cranberry Sherbet'], 'RU', { context: TURKISH_CONTEXT })
    await hepsiniAkit()
    await soz
    expect(cagrilar).toEqual(['("Kızılcık Şerbeti" OR "Cranberry Sherbet") (turkish OR turkey) sourcecountry:RS'])
  })

  it('bağlam yoksa sorgu eskisi gibi', async () => {
    const soz = fetchNewsArticlesGdelt(['Kızılcık Şerbeti'], 'RU')
    await hepsiniAkit()
    await soz
    expect(cagrilar).toEqual(['"Kızılcık Şerbeti" sourcecountry:RS'])
  })
})
