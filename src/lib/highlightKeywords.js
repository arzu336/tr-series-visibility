import { createElement } from 'react'

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

export function highlightKeywordMatches(text, keywords) {
  if (!text || !keywords || keywords.length === 0) return text
  const sorted = [...new Set(keywords)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return text

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
    if (match[0].length === 0) needlePattern.lastIndex++
  }
  if (parts.length === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
