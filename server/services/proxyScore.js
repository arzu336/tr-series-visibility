import { queryTrends } from '../serpapi.js'

// TMDB/JustWatch'ta hiçbir yayın sağlayıcısı bulunmayan ülkeler haritada tamamen boş kalıyordu.
// Bu katman, o ülkeler için Google Trends arama ilgisini gerçek bir PROXY skoru olarak sağlar.
// Bu KESİNLİKLE gerçek yayın/izlenme verisi DEĞİLDİR — sadece o ülkede Türk dizilerine yönelik
// arama ilgisini yansıtan bir yakınsamadır ve haritada ayrı bir renkle (amber) gösterilir.
//
// --- NEDEN TEK TERİM YETMİYOR (canlı ölçüldü) --------------------------------------------------
// Katman uzun süre yalnızca İngilizce `Turkish series` sorgusuna dayanıyordu. Boş kalan 40 ülke
// üzerinde yapılan ölçüm, bu tercihin sistematik bir kör nokta yarattığını gösterdi:
//
//   Terim                    Sinyal veren ülke   Boş listeden kazanılan
//   "Turkish series"                86                    0
//   "مسلسلات تركية"                 21                    1  → Suriye (43)
//   "турецкие сериалы"              22                    3  → Kırgızistan (56),
//                                                             Tacikistan (50), Türkmenistan (19)
//
// Kırgızistan 56 ve Tacikistan 50 — yani bunlar zayıf sinyaller değil, ÜST SIRALARDA yer alan
// gerçek pazarlar. İngilizce terim onları göremiyordu çünkü o ülkelerde kimse Türk dizisini
// İngilizce aramıyor. Terim listesi bu yüzden dile göre genişletildi.
//
// Terim seçimi bilinçli olarak DAR: her ülke/dizi için ayrı sorgu atmak yerine, farklı dil
// ailelerini kapsayan az sayıda jenerik terim kullanılıyor. Maliyet günde 4 SerpAPI çağrısı
// (~120/ay) — haber taramasının GDELT'e taşınmasıyla açılan ~1.875/ay bütçenin küçük bir kısmı.
// Her terim ölçülerek eklendi; "kapsama kazandırmayan terim eklenmez" kuralı bilinçli:
// her terim günde 1 ek SerpAPI çağrısı demek.
//   Fransızca "séries turques" ÖLÇÜLDÜ ve EKLENMEDİ: 4 ülkede sinyal verdi (Cezayir 100,
//   Fransa 50, Fas 50, Belçika 25) ama dördünün de zaten TMDB verisi var — boş kalan
//   ülkelerden hiçbirini kazandırmadı. Batı/Orta Afrika hattı beklenenin aksine boş çıktı.
const FALLBACK_QUERY_TERMS = [
  'Turkish series', // İngilizce — en geniş kapsam (86 ülke)
  'مسلسلات تركية', // Arapça — Orta Doğu / Kuzey Afrika (kazandırdı: Suriye)
  'турецкие сериалы', // Rusça — Orta Asya / Kafkasya (Kırgızistan, Tacikistan, Türkmenistan)
  'سریال‌های ترکی', // Farsça — Afganistan (terimin EN YÜKSEK ülkesi: 100) ve İran
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
      // Bir terimin düşmesi katmanın tamamını düşürmemeli: elde kalan terimlerle devam edilir,
      // hiçbiri gelmezse çağıran taraf (data-pipeline.js) zaten fallback'siz devam ediyor.
      console.error(`[proxyScore] "${term}" için Trends alınamadı: ${err.message}`)
    }
  }
  if (sonuclar.length === 0) throw new Error('Hiçbir proxy terimi için Trends verisi alınamadı')

  const enYuksek = new Map() // ülke etiketi -> { country, value, term }
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
    // Hangi terimden geldiği ülke bazında değişebildiği için tek bir "queryTerm" artık doğru
    // değil; kullanılan terimler listesi ve satır başına kaynağı taşınıyor.
    queryTerm: FALLBACK_QUERY_TERMS.join(' / '),
    queryTerms: FALLBACK_QUERY_TERMS,
    queriedAt: sonuclar[0].queriedAt,
    byCountry,
  }
}
