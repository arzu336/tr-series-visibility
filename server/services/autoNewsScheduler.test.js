import { describe, it, expect, vi, beforeEach } from 'vitest'

// GDELT geçişi (D.6) basın taramasını ~10 saate çıkardı ve zincirde ARKASINDA duran öncü turizm
// sinyali toplayıcısını açlığa itti — canlı veritabanında kanıtı: lastAutoNewsScanAt hiç
// yazılmamıştı, lastTourismTrendsCollectAt ise 7 günlük kapısına rağmen 26 gün boyunca
// 2026-08-26'da donmuştu. Çözüm turu dilimlemek (MAX_RUN_MS). Bu dosya dilimlemenin iki kritik
// sözleşmesini sabitler:
//   1) Süre sınırı bir çifti YARIDA KESMEZ — kontrol çağrıdan ÖNCE yapılır, yoksa GDELT çağrısı
//      harcanmış ama sonucu yazılmamış olurdu.
//   2) deadline verilmeyen yol (anlık tetikleyici, enrichSeriesNewsNow) hiç etkilenmez.
// Gerçek ağ/LLM'e çıkılmaması için fetchAndAnalyzeSentiment taklit ediliyor; bu test HİÇBİR
// meta anahtarı yazmaz (canlı app.db'deki haftalık kapıyı bozmamak için runAutoNewsScanIfNeeded
// bilerek çağrılmıyor).
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
    // İlk çağrı sırasında süre dolar. Kontrol çağrıdan ÖNCE yapıldığı için 1. çift tam olarak
    // biter (scanned=1), 2. çift hiç başlamaz — yarım kalmış bir GDELT çağrısı oluşmaz.
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
