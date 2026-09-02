import { createElement } from 'react'

// Analist Paneli'ndeki "Akıllı Anahtar Kelime Vurgulama" için — analist tüm özeti okumadan,
// atanan tema/destinasyonun gerekçesini 2 saniyede doğrulayabilsin. (createElement kullanılıyor,
// JSX değil — bu dosya src/lib altındaki diğer tüm yardımcılar gibi .js, .jsx değil.)
//
// ÖNEMLİ DÜRÜSTLÜK NOTU: destinasyon tespiti gerçekten bu anahtar kelimelere göre yapılıyor
// (bkz. server/destinations.js DESTINATIONS — LLM başarısız olursa devreye giren yedek yöntem
// TAM OLARAK bu liste; LLM'in kendisi de sinopsiste geçen yer adlarına bakıyor, yani bu kelimeler
// gerçek bir sinyal). TEMA sınıflandırması ise TAMAMEN LLM'e ait (server/llm.js classifyWithLLM,
// sabit bir anahtar kelime listesi kullanmıyor) — THEME_KEYWORD_HINTS burada modelin kendi
// muhakemesinin KANITI DEĞİL, sadece "bu temayla sık birlikte anılan kelimeler" şeklinde bir
// GÖRSEL İPUCU / sezgisel yardımcıdır. Analiste "muhtemelen bu yüzden" fikri verir, "kesin bu
// yüzden" demez — LLM farklı bir gerekçeyle de aynı temayı seçmiş olabilir.
export const THEME_KEYWORD_HINTS = {
  aile: ['aile', 'kardeş', 'anne', 'baba', 'evlat', 'miras', 'soy', 'akraba'],
  'kadın hakları': ['kadın', 'şiddet', 'eşitlik', 'ayrımcılık', 'güçlü kadın', 'taciz'],
  göç: ['göç', 'mülteci', 'yurt dışı', 'gurbet', 'sınır', 'vatan', 'yabancı ülke'],
  adalet: ['adalet', 'mahkeme', 'hukuk', 'dava', 'avukat', 'hakim', 'savcı', 'ceza'],
  aşk: ['aşk', 'sevgi', 'evlilik', 'nişan', 'düğün', 'aşık', 'ilişki'],
  'suç örgütü': ['çete', 'mafya', 'suç örgütü', 'kaçakçılık', 'holding', 'aşiret', 'intikam', 'cinayet', 'silah'],
  tarih: ['tarih', 'imparatorluk', 'savaş', 'sultan', 'padişah', 'osmanlı', 'cumhuriyet', 'fetih'],
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// text içinde keywords listesindeki herhangi birinin GEÇTİĞİ yerleri bulup <mark> ile sarılmış
// bir React düğüm dizisi döner (metin/keywords boşsa ya da hiç eşleşme yoksa metni olduğu gibi
// döner). Türkçe büyük/küçük harf duyarsız (İ/I ayrımı toLocaleLowerCase('tr') ile doğru
// çözülür); daha uzun kelime öbekleri ("güçlü kadın") önce eşleşsin diye uzunluğa göre sıralanır.
export function highlightKeywordMatches(text, keywords) {
  if (!text || !keywords || keywords.length === 0) return text
  const sorted = [...new Set(keywords)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return text

  // Regex'i, orijinal metnin toLocaleLowerCase('tr') uygulanmış bir kopyası üzerinde
  // çalıştırıp bulunan indeksleri ORİJİNAL metne uyguluyoruz — böylece "İstanbul" hem
  // "istanbul" hem "İSTANBUL" ile eşleşir ama gösterilen metin hep orijinal haliyle kalır.
  const haystack = text.toLocaleLowerCase('tr')
  const needlePattern = new RegExp(`(${sorted.map((k) => escapeRegExp(k.toLocaleLowerCase('tr'))).join('|')})`, 'gu')

  const parts = []
  let lastIndex = 0
  let match
  while ((match = needlePattern.exec(haystack)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const original = text.slice(match.index, match.index + match[0].length)
    parts.push(
      createElement('mark', { key: `${match.index}-${original}`, className: 'dashboard__highlight' }, original)
    )
    lastIndex = match.index + match[0].length
    if (match[0].length === 0) needlePattern.lastIndex++ // sonsuz döngü koruması
  }
  if (parts.length === 0) return text // hiç eşleşme yok — orijinal metni aynen döndür
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
