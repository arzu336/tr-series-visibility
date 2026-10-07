/** Haritanın rengi: izlenme düzeyi. */
export const WATCH_LEVEL_NOTE =
  'Renk, ülkenin izlenme düzeyini gösterir (Çok yüksek → Çok düşük). Düzey üç kaynağın birleşiminden ' +
  'gelir: yayın listeleri (son 52 hafta, bütün izlenen platformların birleşik sıralaması), dizi ansiklopedi ' +
  'maddelerinin okunması (ülkenin dilinde, milyon internet kullanıcısı başına) ve arama ilgisi. Gerçek ' +
  'izlenme sayısı ülke bazında kamuya açık değildir; bu yüzden düzey bir sinyaldir, ölçüm değil. En az iki ' +
  'kaynak yoksa ülke gri (tek kaynak varsa taralı tahmin) kalır. Televizyon izlenmesi bu kaynaklara ' +
  'yansımaz; ilgili ülkelerde panel bunu ayrıca uyarır.'

/** Haritanın renk ölçeğinin nasıl kurulduğu. */
export const MAP_SCALE_NOTE =
  'Düzeyler yüzdelik beşliklerdir: "Yüksek", sinyali olan ülkelerin %60–80 aralığında olmak demektir, ' +
  'mutlak bir eşik değil. Türkiye kaynak ülke olduğu için ölçeğe dahil edilmez ve ayrı renkte gösterilir.'

/** Liste kaynağı — her listenin altında yazılır. */
export const CHART_SOURCE_NOTE =
  'Listeler, izlenen yayın platformlarının yayımladığı sıralamaların birleşimidir (haftalık ve günlük) ve ' +
  'Türkiye televizyonunun günlük ilk 10 listesidir (sayısal reyting yayımlanmaz). Yalnızca kataloğumuzdaki ' +
  'Türk dizileri eşleştirilir.'

/** Yayın listesi verisinin sınırı. */
export const NETFLIX_RANK_NOTE =
  'Platformların ülke bazlı ilk 10 listelerine dayanır. Listelerde izlenme saati YOKTUR; yalnızca sıra ' +
  've listede kalınan süre vardır. Platformun hizmet vermediği pazarlarda liste yayımlanmaz; panel bunu ' +
  'açıkça yazar.'

/** Ülke raporu — Türk dizileri sıralaması (platformun kendi haftalık sıralaması). */
export const PLATFORM_LISTS_NOTE =
  'Sıralama, platformun izlediği yayın listelerinden haftalık olarak derlenir: bir dizi o hafta listelerde ' +
  'aldığı en iyi sıraya göre yerleşir; eşitlikte daha fazla listede yer alan önce gelir. "Listede" son 52 ' +
  'haftada sıralamada bulunduğu hafta sayısıdır; değişim bir önceki haftaya göredir. Sıralama izlenme süresi ' +
  'değil liste sırası verisidir.'

/** Yayın varlığı — sayılabilir gerçek, izlenme değil. */
export const AVAILABILITY_NOTE =
  'Hangi dizinin bu ülkede hangi platformda (abonelik, ücretsiz, reklamlı, kiralama, satın alma) ' +
  'bulunduğunu gösterir; anlık görüntüdür. Erişilebilirliği ölçer, izlenmeyi ' +
  'değil; platform kataloğu haftadan haftaya değişebilir.'

/** Lineer TV kör noktası. */
export const LINEAR_TV_NOTE =
  'Yerel ad kaydı bir dizinin o pazarda yerel adla dağıtıldığını gösterir (İngilizce pazarlar hariç). ' +
  'Dağıtım izi güçlü ama yayın listelerinde zayıfsa ve ülkede ilgi sinyali varsa izlenme televizyonda ya ' +
  'da diğer kanallarda olabilir; televizyon izlenmesi doğrudan ölçülmez.'

/** Küresel pazar payı — ihracat değil, popülerlik payı. */
export const MARKET_SHARE_NOTE =
  'Gerçek ihracat/lisans geliri değildir: dört menşe ülkenin (TR, US, KR, ES) en popüler ' +
  'dizilerinin toplam popülerliği içinde Türkiye’nin payıdır. Ticari bir pazar payı ' +
  'göstergesi olarak değil, katalog görünürlüğü göstergesi olarak okunmalıdır.'

/** Medya tonu — temsilî olmayan örneklem. */
export const MEDIA_TONE_NOTE =
  'Yalnızca şimdiye kadar taranmış dizi/ülke çiftlerinin ortalamasıdır; rastgele seçilmiş, ' +
  'temsilî bir örneklem DEĞİLDİR. Tarama yapıldıkça değer değişir.'

/** Destinasyon payı — LLM etiketlemesine dayanır. */
export const DESTINATION_SHARE_NOTE =
  'Dizi özetlerinden otomatik çıkarılan destinasyon etiketlerine dayanır; bir yapımın gerçekte ' +
  'nerede çekildiğini değil, anlatısında hangi destinasyonun geçtiğini yansıtır.'

/** Okunma ilgisi × ziyaretçi sayısı (turizm sekmesi, ülke brifingi). */
export const READING_TOURISM_NOTE =
  'Aylık değerlerin geçen yılın aynı ayına göre değişimi karşılaştırılır (mevsimsellik ayıklanır); pandemi ' +
  'yılları (2020–2022) dışarıdadır ve her dönemin kendi eğilimi çıkarılır. 0–6 ay gecikme denenir, en ' +
  'güçlüsü gösterilir. Art arda aylar bağımsız olmadığından anlamlılık etkin örneklem büyüklüğüyle ve ' +
  'gecikme denemelerine göre düzeltilmiş eşikle hesaplanır. Yalnızca ülkeye özgü diller kullanılır.'

/** Ülke raporu — izlenme sırası. */
export const RANKING_NOTE =
  'Sıra, izlenme düzeyi hesaplanabilen ülkeler arasındaki yüzdelik konumdur; Türkiye kaynak ülke ' +
  'olduğu için dahil edilmez. Sıra mutlak izlenmeyi değil göreli konumu gösterir.'

/** Ülke raporu — bileşik ülke skoru (en çok ilgi gören diziler). */
export const COMPOSITE_SCORE_NOTE =
  'Bileşik skor dört faktörün ağırlıklı ortalamasıdır: arama payı %40, liste başarısı %30 (son 52 ' +
  'haftada listede kalınan hafta ve en iyi sıra), basın algısı %15, yayın varlığı %15. Adaylar önce bu ' +
  'ülkede listelere girmiş dizilerden, kalan yer en popüler dizilerden seçilir. İzleyici puanı ve oy ' +
  'artışı küresel olduğu için skora girmez, ' +
  'bağlam olarak gösterilir. Bir faktör için veri yoksa o faktör dışlanır ve kalan ağırlıklar ' +
  'kendi aralarında yeniden dağıtılır — eksik veri sıfır puan sayılmaz. Arama payı ayda bir arka planda ' +
  'güncellenir.'

/** Ülke raporu — boşluk analizi. */
export const GAP_ANALYSIS_NOTE =
  'Benzer ülkelerde abonelik/ücretsiz yayında olan ama bu ülkede yayında olmayan dizileri listeler. ' +
  '"Benzer ülke" tanımı deneyseldir (bkz. benzer ülke notu). Liste bir talep tahmini değil, katalog ' +
  'farkının envanteridir; lisans, dil ve pazar koşullarını hesaba katmaz.'

/** Ülke raporu — arama ilgisi zaman serisi. */
export const SEARCH_INTEREST_NOTE =
  'Arama ilgisi değerleri her seri için 0-100 arasında GÖRELİdir: 100 o serinin kendi zirvesidir. ' +
  'Farklı diziler ya da ülkeler arasında mutlak hacim karşılaştırması yapılamaz; yalnızca zaman ' +
  'içindeki yön okunur. Seriler ayda bir arka planda güncellenir.'

/** Ülke raporu — benzer ülke tanımı (deneysel). */
export const SIMILAR_COUNTRY_NOTE =
  'Deneysel: aday havuzu aynı bölge veya gelir grubu; sıralama tema dağılımı ' +
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
