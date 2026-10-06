// YouTube yorumlarının dili (kütüphanesiz, kaba tahmin): önce alfabe, Latin alfabesinde sık geçen kelimeler.
// Amaç tek tek yorumu doğru sınıflamak değil, yüzlerce yorumun dil dağılımını çıkarmak; kısa ya da yalnızca
// emojiden oluşan yorumlar sayılmaz (null). Dil ülke değildir: Arapça yorum hangi Arap ülkesinden geldiğini
// söylemez — arayüz bunu ayrıca belirtir.

const SCRIPTS = [
  // Arap alfabesi: Farsça ve Urduca'ya özgü harfler önce
  [/[ٹڈڑںےۓ]/u, 'ur'],
  [/[پچژگیک]/u, 'fa'], // Farsça ye (ی) ve kef (ک) Arapçadakinden (ي ك) farklı kod noktaları
  [/[؀-ۿ]/u, 'ar'],
  // Kiril: dile özgü harfler önce
  [/[ҚқҒғҢңӨөҰұҮүҺһӘә]/u, 'kk'],
  [/[ЂђЋћЏџЉљЊњЈј]/u, 'sr'],
  [/[ЃѓЌќЅѕ]/u, 'mk'],
  [/[ІіЇїЄєҐґ]/u, 'uk'],
  [/[Ѐ-ӿ]/u, 'ru'],
  [/[Ͱ-Ͽ]/u, 'el'],
  [/[Ⴀ-ჿ]/u, 'ka'],
  [/[԰-֏]/u, 'hy'],
  [/[֐-׿]/u, 'he'],
  [/[ऀ-ॿ]/u, 'hi'],
  [/[ঀ-৿]/u, 'bn'],
  [/[฀-๿]/u, 'th'],
  [/[가-힯]/u, 'ko'],
  [/[぀-ヿ]/u, 'ja'],
  [/[一-鿿]/u, 'zh'],
]

// Latin alfabesi: dile özgü sık kelimeler (küçük harf). Türkçe ve Azerice birbirine yakın: Azericeye özgü "ə".
const WORDS = {
  tr: 'bir bu ve çok ne için ama da de mi gibi ben sen o çok güzel dizi bölüm harika neden olsun yok var değil şu kadar',
  en: 'the and is this you it to of i love so very what why episode please series not but are was with my',
  es: 'el la que de los las es muy por una me lo se esta este pero como más mi amor capítulo serie qué',
  pt: 'que não de é muito um uma os as para com eu mais você essa esse amo capítulo série está',
  fr: 'le la les est et je que pas très une des pour il elle cette épisode série mais vous',
  it: 'il che non è la di una per sono molto questa questo ma come anche puntata serie',
  de: 'die der und ist nicht ich das sehr ein eine mit auf aber folge serie wie',
  id: 'yang dan ini itu tidak aku saya ada dengan untuk sangat bagus banget sekali episode kapan',
  ro: 'și este nu că la cu o un mai foarte pentru ce serialul episodul',
  pl: 'nie jest i się że na to bardzo jak co ale odcinek serial',
  sw: 'na ya kwa ni hii sana wa za mimi wewe tamthilia nzuri kipindi',
  sq: 'dhe është një për me që nuk shumë serial episodi',
  sh: 'je i da se ne na sam što ali serija epizoda jako',
  hu: 'és a az nem hogy egy nagyon ez meg sorozat rész',
  uz: 'va bu juda bir men sen emas uchun serial qism',
}
const WORD_SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]))
const TR_CHARS = /[ğışİ]/u

export function detectLanguage(text) {
  const t = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\S+/g, ' ')
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length < 6) return null
  for (const [re, lang] of SCRIPTS) if (re.test(t)) return lang
  if (/ə/i.test(t)) return 'az'
  const words = t.toLocaleLowerCase('tr').match(/\p{L}+/gu) || []
  let best = null
  let bestScore = 0
  for (const [lang, set] of Object.entries(WORD_SETS)) {
    let score = 0
    for (const w of words) if (set.has(w)) score++
    if (lang === 'tr' && TR_CHARS.test(t)) score += 2
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  return bestScore >= 1 ? best : null
}

/** Yorum listesinin dil dağılımı: [{ lang, comments, share }] çoktan aza; tanınmayanlar `unknown` olarak sayılır. */
export function languageDistribution(texts) {
  const counts = new Map()
  let unknown = 0
  for (const t of texts) {
    const lang = detectLanguage(t)
    if (!lang) unknown++
    else counts.set(lang, (counts.get(lang) || 0) + 1)
  }
  const known = [...counts.values()].reduce((s, n) => s + n, 0)
  return {
    total: texts.length,
    unknown,
    langs: [...counts]
      .map(([lang, comments]) => ({ lang, comments, share: known ? comments / known : 0 }))
      .sort((a, b) => b.comments - a.comments),
  }
}
