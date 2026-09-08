// Denetim raporu C.5 — "Skorlama metodolojisi boşlukları". Rapordaki tespit kısaca şuydu:
// haritanın ana skoru "dizi o ülkede flatrate/free yayında mı × küresel TMDB popülerliği"
// toplamıdır — yani ERİŞİLEBİLİRLİĞİ ölçer, izlenmeyi değil; ayrıca nüfus/internet/dil
// normalizasyonu yoktur. Arayüzdeki ipuçları ise "Popülerlik verisine dayalı gösterge." gibi
// belirsiz ifadelerdi ve karar vericiyi yanlış bir kesinlik hissine bırakıyordu.
//
// Bu dosya tek bir doğruluk kaynağı: aynı cümle her yerde birebir aynı geçsin, biri güncellenip
// diğeri eski kalmasın. Kod değişikliği değil ÇERÇEVELEME işi — sayılar aynı, iddiaları dürüst.

/** Haritanın ve ülke/kıta skorlarının ne ölçtüğü. */
export const VISIBILITY_SCORE_NOTE =
  'Bu skor ülkelerdeki fiili izlenme oranını değil; ilgili ülkede flatrate/ücretsiz yayında olan ' +
  'yapımların küresel katalog popülerliğini yansıtır. Nüfus, internet erişimi veya dil için ' +
  'normalize edilmemiştir — ülkeler arası karşılaştırmada bu sınırı göz önünde bulundurun.'

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
