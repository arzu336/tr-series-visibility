
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
export const CONTINENT_SCORE_NOTE =
  'Kıtadaki ülkelerin görünürlük skorlarının ortalaması. ' + VISIBILITY_SCORE_NOTE

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
