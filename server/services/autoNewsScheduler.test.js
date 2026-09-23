import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./newsSentiment.js', () => ({
  fetchAndAnalyzeSentiment: vi.fn(),
}))

const { fetchAndAnalyzeSentiment } = await import('./newsSentiment.js')
const { scanSeriesAcrossCountries } = await import('./autoNewsScheduler.js')

const ULKELER = ['DE', 'FR', 'UA', 'EG', 'PE']

beforeEach(() => {
  vi.mocked(fetchAndAnalyzeSentiment).mockReset()
  vi.mocked(fetchAndAnalyzeSentiment).mockResolvedValue({ fromCache: true })
})

describe('süre sınırı (dilimleme)', () => {
  it('geçmiş bir deadline ile HİÇ çağrı yapmaz ve deadlineReached döner', async () => {
    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { deadline: Date.now() - 1 })

    expect(fetchAndAnalyzeSentiment).not.toHaveBeenCalled()
    expect(sonuc.deadlineReached).toBe(true)
    expect(sonuc.scanned).toBe(0)
  })

  it('sınır çiftin ORTASINDA dolarsa o çift yine de tamamlanır, sonraki başlamaz', async () => {
    const deadline = Date.now() + 50
    vi.mocked(fetchAndAnalyzeSentiment).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 80))
      return { fromCache: true }
    })

    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { deadline })

    expect(fetchAndAnalyzeSentiment).toHaveBeenCalledTimes(1)
    expect(sonuc.scanned).toBe(1)
    expect(sonuc.deadlineReached).toBe(true)
  })

  it('bol süre varsa tüm liste taranır ve deadlineReached false kalır', async () => {
    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { deadline: Date.now() + 60_000 })

    expect(fetchAndAnalyzeSentiment).toHaveBeenCalledTimes(ULKELER.length)
    expect(sonuc.scanned).toBe(ULKELER.length)
    expect(sonuc.deadlineReached).toBe(false)
  })
})

describe('anlık tetikleyici yolu (deadline yok) değişmedi', () => {
  it('deadline verilmezse liste sonuna kadar taranır', async () => {
    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { throttle: false })

    expect(fetchAndAnalyzeSentiment).toHaveBeenCalledTimes(ULKELER.length)
    expect(sonuc.deadlineReached).toBe(false)
  })

  it('bir ülkenin hata vermesi taramayı durdurmaz, failed olarak sayılır', async () => {
    vi.mocked(fetchAndAnalyzeSentiment)
      .mockResolvedValueOnce({ fromCache: true })
      .mockRejectedValueOnce(new Error('GDELT hız sınırı'))
      .mockResolvedValue({ fromCache: true })

    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { throttle: false })

    expect(sonuc.failed).toBe(1)
    expect(sonuc.scanned).toBe(ULKELER.length - 1)
  })

  it('önbellekten gelen çiftler canlı çağrı sayılmaz (dilim bütçesini yemezler)', async () => {
    vi.mocked(fetchAndAnalyzeSentiment)
      .mockResolvedValueOnce({ fromCache: false })
      .mockResolvedValue({ fromCache: true })

    const sonuc = await scanSeriesAcrossCountries(1, 'Dizi', ULKELER, { throttle: false })

    expect(sonuc.liveCalls).toBe(1)
    expect(sonuc.scanned).toBe(ULKELER.length)
  })
})
