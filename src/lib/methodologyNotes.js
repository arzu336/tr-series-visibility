/** Haritanın ve ülke/kıta skorlarının ne ölçtüğü. */
export const VISIBILITY_SCORE_NOTE =
  'Bu skor ülkelerdeki fiili izlenme oranını değil; ilgili ülkede flatrate/ücretsiz yayında olan ' +
  'yapımların küresel katalog popülerliğini yansıtır. Dil için normalize edilmemiştir — ülkeler ' +
  'arası karşılaştırmada bu sınırı göz önünde bulundurun.'

/** Haritanın VARSAYILAN metriği: nüfusa/internet kullanıcısına bölünmüş skor. */
export const PER_CAPITA_SCORE_NOTE =
  'Görünürlük skorunun milyon internet kullanıcısı başına değeri (internet verisi yoksa milyon ' +
  'kişi başına; kaynak: World Bank). Ham toplam skor, ülkede yayında olan dizilerin KÜRESEL ' +
  'popülerlik toplamı olduğu için büyük ölçüde katalog büyüklüğünü ölçüyordu (138 ülkede skor ile ' +
  'dizi sayısı arasındaki korelasyon r = 0,97). Bölme, katalog büyüklüğünü pazar büyüklüğünden ' +
  'ayırır; yine de erişilebilirliği ölçer, izlenmeyi değil.'

/** Haritanın alternatif metriği: ham toplam. */
export const TOTAL_SCORE_NOTE =
  'Ham toplam görünürlük skoru — ülkede yayında olan yapımların küresel popülerliklerinin ' +
  'toplamı. Pazarın MUTLAK büyüklüğünü okumak için doğru metrik, ama büyük ölçüde katalog ' +
  'büyüklüğünü yansıtır (dizi sayısıyla korelasyon r = 0,97); ülkeler arası yoğunluk ' +
  'karşılaştırması için Kişi Başına görünümü kullanın.'

/** Haritanın renk ölçeğinin nasıl kurulduğu. */
export const MAP_SCALE_NOTE =
  'Renkler yüzdelik dilime göre atanır: bir ülkenin rengi, diğer ülkelerin yüzde kaçının üstünde ' +
  'olduğunu gösterir, mutlak farkı değil. Böylece tek bir yüksek değerli ülke gradyanın tamamını ' +
  'ezmez. Türkiye kaynak ülke olduğu için ölçeğe dahil edilmez ve ayrı renkte gösterilir. ' +
  'Mutlak sayı için ülke paneline bakın.'

/** Kıta düzeyinde aynı skorun ortalaması. */
export const CONTINENT_SCORE_NOTE = 'Kıtadaki ülkelerin görünürlük skorlarının ortalaması. ' + VISIBILITY_SCORE_NOTE

/** Küresel pazar payı — ihracat değil, TMDB popülerlik payı. */
export const MARKET_SHARE_NOTE =
  'Gerçek ihracat/lisans geliri değildir: dört menşe ülkenin (TR, US, KR, ES) en popüler ' +
  'dizilerinin toplam TMDB popülerliği içinde Türkiye’nin payıdır. Ticari bir pazar payı ' +
  'göstergesi olarak değil, katalog görünürlüğü göstergesi olarak okunmalıdır.'

/** Medya tonu — temsilî olmayan örneklem. */
export const MEDIA_TONE_NOTE =
  'Yalnızca şimdiye kadar taranmış dizi/ülke çiftlerinin ortalamasıdır; rastgele seçilmiş, ' +
  'temsilî bir örneklem DEĞİLDİR. Tarama yapıldıkça değer değişir.'

/** Destinasyon payı — LLM etiketlemesine dayanır. */
export const DESTINATION_SHARE_NOTE =
  'Dizi özetlerinden LLM ile çıkarılan destinasyon etiketlerine dayanır; bir yapımın gerçekte ' +
  'nerede çekildiğini değil, anlatısında hangi destinasyonun geçtiğini yansıtır.'

/** Ülke raporu — sıralama. */
export const RANKING_NOTE =
  'Sıralama yalnızca yayın verisi olan ülkeler arasında yapılır; Türkiye kaynak ülke olduğu için ' +
  'dahil edilmez. Kişi başına sıralamada paydası 1 milyon internet kullanıcısının altındaki ülkeler ' +
  '(oranı istikrarsız) sayılmaz. Sıra, mutlak büyüklüğü değil göreli konumu gösterir.'

/** Ülke raporu — bileşik ülke skoru (en çok ilgi gören diziler). */
export const COMPOSITE_SCORE_NOTE =
  'Bileşik skor dört faktörün ağırlıklı ortalamasıdır: arama payı %40, Netflix Top 10 %30, basın ' +
  'algısı %15, yayın varlığı %15. Bir faktör için veri yoksa o faktör dışlanır ve kalan ağırlıklar ' +
  'kendi aralarında yeniden dağıtılır — eksik veri sıfır puan sayılmaz. Rapor üretiminde ücretli ' +
  'arama sorgusu yapılmaz; arama payı yalnızca daha önce önbelleğe alınmışsa hesaba girer.'

/** Ülke raporu — Netflix Top 10 geçmişi. */
export const NETFLIX_RANK_NOTE =
  "Netflix'in ülke bazlı resmî Top 10 dosyasına dayanır. Bu dosyada izlenme saati YOKTUR; yalnızca " +
  "haftalık sıra (1-10) ve Top 10'da kalınan hafta sayısı vardır. Sıra puanı bunlardan türetilmiş, " +
  'şeffaf bir göstergedir; gerçek izlenme değildir. Kaynak dosya kısmen indirilebildiği için bazı ' +
  'ülkeler kapsam dışında kalabilir — bu durumda rapor bunu açıkça yazar.'

/** Ülke raporu — yayın varlığı matrisi. */
export const AVAILABILITY_NOTE =
  'Hangi dizinin bu ülkede hangi platformda (abonelik, ücretsiz, reklamlı, kiralama, satın alma) ' +
  'bulunduğunu gösterir; kaynak TMDB/JustWatch, anlık görüntüdür. Erişilebilirliği ölçer, izlenmeyi ' +
  'değil; platform kataloğu haftadan haftaya değişebilir.'

/** Ülke raporu — boşluk analizi. */
export const GAP_ANALYSIS_NOTE =
  'Benzer ülkelerde abonelik/ücretsiz yayında olan ama bu ülkede yayında olmayan dizileri listeler. ' +
  '"Benzer ülke" tanımı deneyseldir (bkz. benzer ülke notu). Liste bir talep tahmini değil, katalog ' +
  'farkının envanteridir; lisans, dil ve pazar koşullarını hesaba katmaz.'

/** Ülke raporu — arama ilgisi zaman serisi. */
export const SEARCH_INTEREST_NOTE =
  'Google Trends değerleri her seri için 0-100 arasında GÖRELİdir: 100 o serinin kendi zirvesidir. ' +
  'Farklı diziler ya da ülkeler arasında mutlak hacim karşılaştırması yapılamaz; yalnızca zaman ' +
  'içindeki yön okunur. Rapor yalnızca önceden sorgulanmış (önbellekteki) serileri gösterir.'

/** Ülke raporu — benzer ülke tanımı (deneysel). */
export const SIMILAR_COUNTRY_NOTE =
  'Deneysel: aday havuzu aynı Dünya Bankası bölgesi veya gelir grubu; sıralama tema dağılımı ' +
  'benzerliği (kosinüs) ile yapılır ve küçük kataloglu ülkeler güven çarpanıyla aşağı çekilir. Tema ' +
  'dağılımı katalog büyüklüğünden etkilenir; benzerlik izleyici zevkinin doğrudan ölçümü değildir.'

/** Ülke raporu — öne çıkan bulgular. */
export const FINDINGS_NOTE =
  'Bulgular sabit kurallarla, yalnızca rapordaki sayılardan türetilir; yapay zeka metni değildir ve ' +
  'öneri içermez. Veri eksikse bulgu sayısı azalır, uydurulmaz.'

/** Ülke raporu — trend yönü. */
export const TREND_NOTE =
  'Kısa vadeli yön, görünürlük skorunun 7 gün önceki anlık görüntüye göre değişimidir (±%5 eşik); ' +
  'aylık seri, o aydaki anlık görüntülerin ortalamasıdır. Skor erişilebilirliği ölçer; yön, katalog ' +
  'değişimini yansıtır, izleyici davranışını değil.'

/** Ülke raporu — veriye göre öne çıkan diziler. */
export const HIGHLIGHTED_SERIES_NOTE =
  'Bileşik skoru en yüksek ve en az iki kaynakla ("Çift Kaynakla Doğrulandı" ya da kısmi doğrulama) ' +
  'desteklenen dizilerdir. Bir öneri değil, mevcut verinin sıralamasıdır; kriter her satırda yazılıdır.'
