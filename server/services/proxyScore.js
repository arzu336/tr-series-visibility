import { queryTrends } from '../serpapi.js'

const FALLBACK_QUERY_TERMS = [
  'Turkish series',
  'مسلسلات تركية',
  'турецкие сериалы',
  'سریال‌های ترکی',
]

/**
 * Ülke başına EN YÜKSEK değeri alır. Ortalama almak yanlış olurdu: her terim kendi 0-100
 * skalasında normalize edilir (bkz. denetim D.4) ve bir ülkede Rusça terim 56 iken İngilizce
 * terimin 0 olması "ilgi az" demek değil, "o dilde aranmıyor" demektir. Sıfırları ortalamaya
 * katmak gerçek sinyali sulandırır; maksimum, "bu ülkede Türk dizilerine ölçülebilir bir ilgi
 * VAR mı" sorusunun dürüst cevabıdır. Değer yine de terimler arası mutlak bir kıyas değildir —
 * arayüz bunu zaten tahmin (amber) olarak etiketler.
 */
export async function getFallbackInterestScores() {
  const sonuclar = []
  for (const term of FALLBACK_QUERY_TERMS) {
    try {
      const result = await queryTrends(term)
      sonuclar.push({ term, ...result })
    } catch (err) {
      console.error(`[proxyScore] "${term}" için Trends alınamadı: ${err.message}`)
    }
  }
  if (sonuclar.length === 0) throw new Error('Hiçbir proxy terimi için Trends verisi alınamadı')

  const enYuksek = new Map()
  for (const s of sonuclar) {
    for (const satir of s.byCountry || []) {
      if (!satir?.country || typeof satir.value !== 'number' || satir.value <= 0) continue
      const mevcut = enYuksek.get(satir.country)
      if (!mevcut || satir.value > mevcut.value) {
        enYuksek.set(satir.country, { country: satir.country, value: satir.value, term: s.term })
      }
    }
  }

  const byCountry = [...enYuksek.values()].sort((a, b) => b.value - a.value)
  return {
    queryTerm: FALLBACK_QUERY_TERMS.join(' / '),
    queryTerms: FALLBACK_QUERY_TERMS,
    queriedAt: sonuclar[0].queriedAt,
    byCountry,
  }
}
