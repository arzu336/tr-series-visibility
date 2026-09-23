import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regresyon: ilk /api/visibility isteği 400 dizinin LLM sınıflandırmasını satır içi bekliyordu;
// LLM kapalıysa dakikalarca yanıt yoktu. Artık sınıflandırma arka planda tek bir iş olarak
// koşar, istek elde olan etiketlerle hemen döner; yalnızca scheduler bekler.

const HAM = {
  series: [
    { id: 1, name: 'Terzi', popularity: 50, overview: 'x' },
    { id: 2, name: 'Atiye', popularity: 30, overview: 'y' },
  ],
  providersById: {
    1: { DE: { flatrate: [{ provider_id: 8 }] } },
    2: { DE: { flatrate: [{ provider_id: 8 }] }, FR: { flatrate: [{ provider_id: 8 }] } },
  },
}

// Sınıflandırma "hiç bitmeyen" bir iş: LLM kapalı senaryosu. vi.mock hoist edildiği için
// fabrikaların kullandığı değerler vi.hoisted ile tanımlanır.
const h = vi.hoisted(() => {
  const durum = { coz: null }
  return {
    durum,
    siniflandirma: vi.fn(() => new Promise((resolve) => { durum.coz = resolve })),
    tespit: vi.fn(async () => ({})),
    temaDeposu: {},
  }
})
const { siniflandirma, tespit, temaDeposu } = h
const siniflandirmaCoz = () => h.durum.coz?.()

vi.mock('./tmdb.js', async (orig) => ({ ...(await orig()), getRawSeriesData: async () => HAM }))
vi.mock('./cache.js', () => ({ getCached: () => null, setCached: () => {} }))
vi.mock('./themes.js', async (orig) => ({ ...(await orig()), ensureClassified: h.siniflandirma, getThemeStore: () => h.temaDeposu }))
vi.mock('./destinations.js', async (orig) => ({ ...(await orig()), ensureDetected: h.tespit, getDestinationStore: () => ({}) }))
vi.mock('./services/countryDemographics.js', () => ({ getCountryDemographics: async () => ({}) }))
vi.mock('./services/proxyScore.js', () => ({ getFallbackInterestScores: async () => ({}) }))
vi.mock('./history.js', () => ({ loadHistoryStore: () => ({}), getTrend: () => ({ direction: 'yetersiz-veri' }), maybeRecordSnapshot: () => {} }))
vi.mock('./series-period-history.js', () => ({ maybeRecordSeriesSnapshot: () => {} }))
vi.mock('./aggregate.js', async (orig) => {
  const gercek = await orig()
  return { ...gercek, mergeProxyFallback: (c) => c, attachPerCapitaScores: (c) => c }
})

const { getEnrichedVisibility } = await import('./data-pipeline.js')

beforeEach(() => {
  siniflandirma.mockClear()
  tespit.mockClear()
  for (const k of Object.keys(temaDeposu)) delete temaDeposu[k]
})

// Modül düzeyindeki "uçuş içi" iş testler arasında asılı kalmasın: bekleyen sınıflandırma çözülür.
afterEach(async () => {
  siniflandirmaCoz()
  await new Promise((r) => setTimeout(r, 0))
})

describe('getEnrichedVisibility — sınıflandırmayı beklemez', () => {
  it('LLM hiç yanıt vermese bile harita verisi hemen döner, eksik temalar "diğer"', async () => {
    const zaman = Date.now()
    const { data } = await getEnrichedVisibility()
    expect(Date.now() - zaman).toBeLessThan(2000)
    expect(data.countries.map((c) => c.iso2).sort()).toEqual(['DE', 'FR'])
    const de = data.countries.find((c) => c.iso2 === 'DE')
    expect(de.seriesList.every((s) => s.theme === 'diğer')).toBe(true)
  })

  it('eş zamanlı isteklerde sınıflandırma TEK kez başlatılır (arka planda bir iş)', async () => {
    await Promise.all([getEnrichedVisibility(), getEnrichedVisibility(), getEnrichedVisibility()])
    expect(siniflandirma).toHaveBeenCalledTimes(1)
  })

  it('arka plan işi bitince bir sonraki istek yeni etiketleri görür', async () => {
    await getEnrichedVisibility()
    temaDeposu['1'] = { theme: 'tarih', confidence: 90, humanOverride: null }
    siniflandirmaCoz()
    await new Promise((r) => setTimeout(r, 0))
    const { data } = await getEnrichedVisibility()
    const terzi = data.countries.find((c) => c.iso2 === 'DE').seriesList.find((s) => s.id === 1)
    expect(terzi.theme).toBe('tarih')
  })

  it('waitForClassification: true ile (scheduler) bitmesini bekler', async () => {
    let bitti = false
    const soz = getEnrichedVisibility({ waitForClassification: true }).then(() => { bitti = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(bitti).toBe(false)
    siniflandirmaCoz()
    await soz
    expect(bitti).toBe(true)
  })
})
