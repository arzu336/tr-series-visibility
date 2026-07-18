import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_PATH = path.join(__dirname, 'data', 'theme-store.json')

export const THEMES = [
  'aile',
  'kadın hakları',
  'göç',
  'adalet',
  'aşk',
  'suç örgütü',
  'tarih',
  'diğer',
]

const KEYWORDS = {
  aile: ['aile', 'kardeş', 'anne', 'baba', 'evlat', 'miras', 'yuva'],
  'kadın hakları': ['kadın', 'şiddet', 'eşitlik', 'taciz', 'güçlü kadın'],
  göç: ['göç', 'sürgün', 'yabancı', 'mülteci', 'gurbet', 'yurt dışı'],
  adalet: ['adalet', 'suç', 'mahkeme', 'polis', 'intikam', 'ceza', 'dava'],
  aşk: ['aşk', 'sevgi', 'evlilik', 'düğün', 'aşık', 'kalp'],
  'suç örgütü': ['mafya', 'çete', 'suç örgütü', 'yeraltı', 'teşkilat', 'istihbarat', 'casus'],
  tarih: ['tarih', 'dönem', 'imparatorluk', 'sultan', 'gazi', 'kuruluş', 'osmanlı', 'padişah'],
}

export function classifyTheme(overview) {
  const text = (overview || '').toLocaleLowerCase('tr')
  const counts = {}
  for (const theme of Object.keys(KEYWORDS)) {
    counts[theme] = KEYWORDS[theme].reduce(
      (sum, word) => sum + (text.includes(word) ? 1 : 0),
      0
    )
  }

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const [topTheme, topCount] = ranked[0]
  const secondCount = ranked[1] ? ranked[1][1] : 0
  const totalMatches = Object.values(counts).reduce((a, b) => a + b, 0)

  if (totalMatches === 0) {
    return { theme: 'diğer', confidence: 0 }
  }
  if (topCount === secondCount) {
    return { theme: topTheme, confidence: 50 }
  }
  return { theme: topTheme, confidence: Math.round((topCount / totalMatches) * 100) }
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export function ensureClassified(series) {
  const store = loadStore()
  let changed = false

  for (const s of series) {
    const key = String(s.id)
    if (!store[key]) {
      const { theme, confidence } = classifyTheme(s.overview)
      store[key] = {
        id: s.id,
        name: s.name,
        overview: s.overview,
        theme,
        confidence,
        classifiedAt: new Date().toISOString(),
        humanOverride: null,
      }
      changed = true
    }
  }

  if (changed) saveStore(store)
  return store
}

export function getThemeStore() {
  return loadStore()
}

export function setHumanOverride(seriesId, theme, reviewer) {
  if (!THEMES.includes(theme)) {
    throw new Error(`Geçersiz tema: ${theme}`)
  }
  const store = loadStore()
  const key = String(seriesId)
  if (!store[key]) {
    throw new Error(`Dizi bulunamadı: ${seriesId}`)
  }
  store[key].humanOverride = {
    theme,
    reviewer: reviewer || 'anonim',
    at: new Date().toISOString(),
  }
  saveStore(store)
  return store[key]
}

export function effectiveTheme(entry) {
  return entry.humanOverride?.theme ?? entry.theme
}

export function effectiveConfidence(entry) {
  return entry.humanOverride ? 100 : entry.confidence
}
