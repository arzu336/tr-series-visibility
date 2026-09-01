import { getEnrichedVisibility } from '../data-pipeline.js'

// --- Kapasite planlaması (kullanıcı talebi: "5.000 aylık kotayı ~3.500-4.000 çağrı/ay bandına
// oturt") ---------------------------------------------------------------------------------------
// Talep edilen "Top 50 Dizi × Top 30 Ülke + 7 günlük TTL + 30 oyuncu × 30 ülke" LİTERAL uygulanırsa
// gerçek maliyet:
//   Basın: 1500 çift × 1 çağrı × (30/7 ≈ 4.3 yenileme/ay)  ≈ 6.400/ay
//   Sosyal: 1500 çift × 2 çağrı × 4.3                       ≈ 12.900/ay
//   Oyuncu (naif, kişi×ülke):  30 × 30 × 4.3                ≈  3.900/ay
//   TOPLAM ≈ 23.000/ay — 5.000 kotanın ~4.6 katı, tek başına basın kalemi bile kotayı aşıyor.
// Bu yüzden 3 parametre GERÇEK bütçeye göre yeniden ayarlandı (aşağıda gerekçeleriyle):
//   1) Havuz 20×15'ten 35×25'e büyütüldü (kombinasyon 300→875, ~2.9 kat — "agresif" ama sonlu).
//   2) Basın TTL'i 30 günden 14 güne indi (ayda ~2.1 yenileme) — talep edilen 7 günün YARISI kadar
//      sık ama bütçeyi koruyor; sosyal TTL'i BİLEREK 30 günde kaldı (çift maliyetli — Bilgi Grafiği/
//      YouTube verisi haftalık değişmiyor zaten, buradan tasarruf edilen pay havuz büyümesine
//      aktarıldı).
//   3) Oyuncu toplayıcısı (actorTrendsCollector.js) kişi×ülke DEĞİL, series-adı Trends sorgusuyla
//      AYNI mekanizmayı (GEO_MAP_0, geo parametresiz) kullanıyor — TEK çağrı o oyuncunun TÜM
//      ülkelerdeki ilgisini döner, yani 30 oyuncu = 30 çağrı/tarama, 900 değil.
// Sonuç: Basın (875×1×2.1≈1.850) + Sosyal (875×2×1≈1.750) + Oyuncu (30×1×4.3≈130) ≈ 3.730/ay —
// hedeflenen 3.500-4.000 bandının içinde, 5.000 sert tavanın altında, on-demand kullanım için de
// pay bırakıyor. Gerçek güvence yine de serpApiCache.js'teki merkezi aylık bütçe sayacı.
export const TOP_SERIES_COUNT = 35
export const TOP_COUNTRY_COUNT = 25
export const TOP_ACTOR_COUNT = 30

// Kullanıcı talebi: "Latin Amerika, MENA, Doğu Avrupa ve Orta Asya'dan 15 yeni ülke ekle." Saf skor
// sıralamasına bırakılsa bu bölgelerden bazıları (özellikle MENA) hep aynı birkaç ülkeyle temsil
// ediliyor ya da hiç girmiyor olabiliyor — bütçe 30 yerine 25 ülkeye izin verdiği için liste 15
// yerine 12'ye (bölge başına 3) ölçeklendi, aynı 4 bölgeyi kapsayacak şekilde. Hiçbiri uydurma
// değil — platformun GERÇEK görünürlük verisinde bu ülkeler zaten var, sadece skor sıralamasında
// üst 25'e giremeyebiliyorlardı; bir ülkenin gerçek verisi yoksa (aşağıdaki filtre) sessizce atlanır.
const CURATED_DIVERSITY_ISO2 = [
  'AR', 'PE', 'BO', // Latin Amerika
  'SA', 'EG', 'MA', // MENA
  'UA', 'RS', 'BA', // Doğu Avrupa
  'KZ', 'UZ', 'TM', // Orta Asya
]

function buildCountryPool(countries, targetCount) {
  const byScore = [...countries].filter((c) => c.dataSource !== 'proxy').sort((a, b) => b.score - a.score)
  const byIso2 = new Map(byScore.map((c) => [c.iso2, c]))
  const curated = CURATED_DIVERSITY_ISO2.map((iso2) => byIso2.get(iso2)).filter(Boolean)
  const curatedSet = new Set(curated.map((c) => c.iso2))
  const naturalSlots = Math.max(0, targetCount - curated.length)
  const natural = byScore.filter((c) => !curatedSet.has(c.iso2)).slice(0, naturalSlots)
  return [...natural, ...curated]
}

// server/services/autoNewsScheduler.js VE server/services/socialEnricher.js AYNI "en popüler 35
// dizi × en görünür 25 ülke" taramasını paylaşıyor — seçim mantığı burada TEK yerde, ikisi de aynı
// 875 çifti tarar; farklı kriterlerle iki ayrı liste üretilmez. Proxy ülkeler (gerçek arama hacmi
// olmayan, sabit skorlu) hariç tutulur.
export async function getEnrichmentTargets() {
  const { data, raw } = await getEnrichedVisibility()

  const topSeries = [...raw.series]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, TOP_SERIES_COUNT)
    .map((s) => ({ id: s.id, name: s.name }))

  const topCountries = buildCountryPool(data.countries, TOP_COUNTRY_COUNT).map((c) => c.iso2)

  return { topSeries, topCountries }
}

// server/services/actorTrendsCollector.js için — series/ülke havuzundan BAĞIMSIZ, tüm dizilerin
// kadrosu taranıp GERÇEK TMDB popülerliğine göre en üstteki N oyuncu seçilir. TMDB'den oyuncu
// SEVİYESİNDE bir "gerçek popülerlik" alanı çekilmiyor (bkz. tmdb.js getCredits — sadece id/name/
// character/profilePath) — bu yüzden proxy olarak, o oyuncunun rol aldığı dizilerin TOPLAM TMDB
// popülerliği kullanılıyor (countryScoringEngine.js'teki "gerçek veri, türetilmiş sıralama"
// dürüstlüğüyle aynı ilke — uydurma bir "oyuncu puanı" değil, gerçek dizi popülerliklerinin toplamı).
export async function getTopActors(n = TOP_ACTOR_COUNT) {
  const { raw } = await getEnrichedVisibility()
  const byActor = new Map()
  for (const s of raw.series) {
    for (const actor of s.cast || []) {
      const existing = byActor.get(actor.id)
      if (existing) {
        existing.popularitySum += s.popularity
        existing.seriesCount += 1
      } else {
        byActor.set(actor.id, { id: actor.id, name: actor.name, profilePath: actor.profilePath, popularitySum: s.popularity, seriesCount: 1 })
      }
    }
  }
  return [...byActor.values()].sort((a, b) => b.popularitySum - a.popularitySum).slice(0, n)
}
