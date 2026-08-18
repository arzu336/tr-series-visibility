import { queryTrends } from '../serpapi.js'

// TMDB/JustWatch'ta hiçbir yayın sağlayıcısı bulunmayan ülkeler (server/aggregate.js'in
// byCountry'sinde hiç görünmeyen ~9 ülke: Ermenistan, Gürcistan, Suriye, Bangladeş,
// Kazakistan, Sri Lanka, Özbekistan, Vietnam, Etiyopya gibi) haritada tamamen boş/veri yok
// olarak kalıyordu. Bu ülkeler için TEK bir genel Google Trends sorgusuyla (SerpApi,
// zaten sonsuza dek önbelleklenen queryTrends — server/serpapi.js) "Turkish series" arama
// ilgisini gerçek bir PROXY skoru olarak sağlar. Bu KESİNLİKLE gerçek yayın/izlenme verisi
// DEĞİLDİR — sadece o ülkede Türk dizilerine genel arama ilgisini yansıtan bir yakınsamadır
// (TrendsExplorer/seriesFilter'daki aynı dürüstlük ilkesi). Tek bir jenerik terim
// kullanılması bilinçli bir tercih: SerpAPI'nin ücretsiz kotası aylık sınırlı olduğu için
// (bkz. serpapi.js 429 hata mesajı), her ülke veya her dizi için ayrı sorgu atmak yerine
// tek bir sorgu tüm eksik ülkeleri kapsar.
const FALLBACK_QUERY_TERM = 'Turkish series'

export async function getFallbackInterestScores() {
  const result = await queryTrends(FALLBACK_QUERY_TERM)
  return {
    queryTerm: FALLBACK_QUERY_TERM,
    queriedAt: result.queriedAt,
    byCountry: result.byCountry,
  }
}
