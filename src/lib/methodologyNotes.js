/** Haritanın rengi: izlenme düzeyi. */
export const WATCH_LEVEL_NOTE =
  'Renk, ülkenin izlenme düzeyini gösterir (Çok yüksek → Çok düşük). Düzey üç gerçek kaynağın ' +
  'birleşiminden gelir: Netflix Top 10 (son 52 hafta, resmî haftalık liste), dizi Wikipedia ' +
  'makalelerinin okunması (ülkenin dilinde, milyon internet kullanıcısı başına) ve Google Trends arama ' +
  'ilgisi (yalnızca önbellekteki sorgular). Gerçek izlenme sayısı ülke bazında kamuya açık değildir; bu ' +
  'yüzden düzey bir sinyaldir, ölçüm değil. En az iki kaynak yoksa ülke gri kalır. Lineer TV izlenmesi ' +
  '(Antena 3, Canale 5, Domashniy gibi kanallar) hiçbir kaynağa yansımaz; ilgili ülkelerde panel bunu ' +
  'ayrıca uyarır.'

/** Haritanın renk ölçeğinin nasıl kurulduğu. */
export const MAP_SCALE_NOTE =
  'Düzeyler yüzdelik beşliklerdir: "Yüksek", sinyali olan ülkelerin %60–80 aralığında olmak demektir, ' +
  'mutlak bir eşik değil. Türkiye kaynak ülke olduğu için ölçeğe dahil edilmez ve ayrı renkte gösterilir.'

/** Liste kaynağı — her listenin altında yazılır. */
export const CHART_SOURCE_NOTE =
  'Listeler kaynağın kendi yayımladığı sıralamadır: Netflix Top 10 (Tudum, haftalık, 94 pazar) ve Türkiye TV ' +
  'günlük Top 10 (reytingtv.com, TİAK sırası; sayısal reyting yayımlanmaz). Yalnızca kataloğumuzdaki Türk ' +
  'dizileri eşleştirilir; "katalog dışı" ve "dizi değil" satırlar süzgeç açıldığında görünür.'

/** Netflix Top 10 verisinin sınırı. */
export const NETFLIX_RANK_NOTE =
  "Netflix'in ülke bazlı resmî Top 10 dosyasına dayanır. Bu dosyada izlenme saati YOKTUR; yalnızca " +
  "haftalık sıra (1-10) ve Top 10'da kalınan hafta sayısı vardır. Netflix'in hizmet vermediği ya da " +
  'çekildiği pazarlarda (ör. Rusya, 2022) liste yayımlanmaz; panel bunu açıkça yazar.'

/** Platform listeleri (ülke raporu + ülke paneli "Şu an listede"). */
export const PLATFORM_LISTS_NOTE =
  'Netflix için resmî haftalık Top 10; Disney+, Prime Video, HBO Max, Apple TV+ ve Shahid için platformların ' +
  'günlük Top 10 listelerinden haftada bir alınan anlık görüntüler. Bu listelerde izlenme saati yoktur, ' +
  'yalnızca sıra vardır. Aynı dizi birden çok platformun listesindeyse tek satırda, en iyi sırasıyla ' +
  'gösterilir. Netflix dışı platformların geçmişi, takibin başladığı tarihten itibaren birikir.'

/** Yayın varlığı — sayılabilir gerçek, izlenme değil. */
export const AVAILABILITY_NOTE =
  'Hangi dizinin bu ülkede hangi platformda (abonelik, ücretsiz, reklamlı, kiralama, satın alma) ' +
  'bulunduğunu gösterir; kaynak TMDB/JustWatch, anlık görüntüdür. Erişilebilirliği ölçer, izlenmeyi ' +
  'değil; platform kataloğu haftadan haftaya değişebilir.'

/** Lineer TV kör noktası. */
export const LINEAR_TV_NOTE =
  'IMDb yerel başlık kaydı bir dizinin o pazarda yerel adla dağıtıldığını gösterir (İngilizce pazarlar ' +
  'hariç). Dağıtım izi güçlü ama Netflix Top 10 zayıfsa ve ülkede ilgi sinyali varsa izlenme lineer TV ' +
  'ya da diğer kanallarda olabilir; hiçbir kaynağımız lineer TV izlenmesini ölçmez.'

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

/** Ülke raporu — izlenme sırası. */
export const RANKING_NOTE =
  'Sıra, izlenme düzeyi hesaplanabilen ülkeler arasındaki yüzdelik konumdur; Türkiye kaynak ülke ' +
  'olduğu için dahil edilmez. Sıra mutlak izlenmeyi değil göreli konumu gösterir.'

/** Ülke raporu — bileşik ülke skoru (en çok ilgi gören diziler). */
export const COMPOSITE_SCORE_NOTE =
  'Bileşik skor dört faktörün ağırlıklı ortalamasıdır: arama payı %40, Netflix Top 10 %30, basın ' +
  'algısı %15, yayın varlığı %15. Bir faktör için veri yoksa o faktör dışlanır ve kalan ağırlıklar ' +
  'kendi aralarında yeniden dağıtılır — eksik veri sıfır puan sayılmaz. Rapor üretiminde ücretli ' +
  'arama sorgusu yapılmaz; arama payı yalnızca daha önce önbelleğe alınmışsa hesaba girer.'

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
  'Kısa vadeli yön, yayın varlığının (yayındaki dizi sayısı ve katalog ağırlığı) 7 gün önceki anlık ' +
  'görüntüye göre değişimidir (±%5 eşik); aylık seri o aydaki anlık görüntülerin ortalamasıdır. Yön ' +
  'katalog değişimini yansıtır, izleyici davranışını değil.'

/** Ülke raporu — veriye göre öne çıkan diziler. */
export const HIGHLIGHTED_SERIES_NOTE =
  'Bileşik skoru en yüksek ve en az iki kaynakla ("Çift Kaynakla Doğrulandı" ya da kısmi doğrulama) ' +
  'desteklenen dizilerdir. Bir öneri değil, mevcut verinin sıralamasıdır; kriter her satırda yazılıdır.'

/** Tema dağılımı — katalog ağırlığı. */
export const THEME_SHARE_NOTE =
  'Tema payları, ülkede yayında olan dizilerin küresel katalog ağırlığına göre hesaplanır; izlenmeyi ' +
  'değil kataloğun tema dağılımını gösterir.'
