import { cacheFirstSerpApi, serpapiGet, TRENDS_TTL_MS } from './serpApiCache.js'

// Modül B — bir ülkede yayında olan en fazla 5 Türk dizisini TEK bir SerpAPI google_trends
// çağrısında (data_type=TIMESERIES, virgülle ayrılmış q) karşılaştırıp göreceli "Share of
// Search" (arama payı, 0-100) çıkarır. server/serpapi.js'teki tekil-dizi GEO_MAP_0 sorgusundan
// FARKLI bir uç nokta şekli — burada ayrı bir cache anahtar alanı (serp:sos:) kullanılıyor,
// server/regional-interest.js'in kullandığı serp:trends: ile KARIŞTIRILMIYOR (farklı veri
// şekli, farklı SerpAPI parametreleri).
//
// SerpAPI/Google Trends TEK sorguda EN FAZLA 5 terimi kabul ediyor (doğrulandı, bkz.
// data-pipeline-python/trends_country_ranker.py docstring'i — 6. terimde "Maximum number of
// queries accepted is 5" hatası dönüyor). Bu yüzden 5'ten fazla dizi ile çağrılırsa (ör.
// countryScoringEngine.js top-5 seçimini atlarsa) burada bilerek İLK 5 alınır, sessizce
// bölünüp gruplara ayrılmaz (o karmaşıklık sadece >5 gerçekten gerektiğinde,
// trends_country_ranker.py'nin Python tarafında var).
const MAX_TERMS = 5

function normalizeTitle(title) {
  return title.trim().toLocaleLowerCase('tr')
}

function shareOfSearchCacheKey(iso2, titles) {
  const sorted = titles.map(normalizeTitle).sort()
  return `serp:sos:${iso2.toUpperCase()}:${sorted.join('|')}`
}

async function fetchShareOfSearchRaw(titles, iso2, timeframe) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: titles.join(','),
    geo: iso2.toUpperCase(),
    date: timeframe,
    data_type: 'TIMESERIES',
    hl: 'tr',
  })

  const averages = data.interest_over_time?.averages || []
  const rawByTitle = new Map(averages.map((a) => [a.query, a.value]))
  // Share of Search: bu ülke/zaman aralığında dizilerin BİRBİRİNE GÖRE arama hacmi payı.
  // Toplam ilgi hiç yoksa (tüm değerler 0) bölme hatası yerine dürüstçe eşit pay (uydurma
  // bir "kazanan" göstermemek için) değil, sıfır pay döndürülür — aşağıda total guard'ı.
  const total = averages.reduce((sum, a) => sum + (a.value || 0), 0)
  const items = titles.map((title) => {
    const raw = rawByTitle.get(title) ?? 0
    return {
      title,
      rawInterest: raw,
      shareOfSearchPct: total > 0 ? Math.round((raw / total) * 1000) / 10 : 0,
    }
  })

  return { iso2: iso2.toUpperCase(), titles, timeframe, queriedAt: new Date().toISOString(), items }
}

/**
 * titles: 2-5 Türk dizisi adı (aynı ülkede yayında olanlar — bkz.
 * server/services/countryScoringEngine.js top-5 seçimi). 1'den az terimle "pay" kavramı
 * anlamsız, 5'ten fazlası SerpAPI'nin tek-sorgu sınırını aşar — ikisi de dürüstçe hata
 * fırlatır, sessizce kırpma/doldurma yapılmaz.
 */
export async function calculateShareOfSearch(iso2, titles, timeframe = 'today 12-m') {
  if (!Array.isArray(titles) || titles.length < 2) {
    throw new Error('Share of Search için en az 2 dizi adı gerekir')
  }
  if (titles.length > MAX_TERMS) {
    throw new Error(`Share of Search tek sorguda en fazla ${MAX_TERMS} dizi karşılaştırabilir (${titles.length} verildi)`)
  }
  const key = shareOfSearchCacheKey(iso2, titles)
  return cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchShareOfSearchRaw(titles, iso2, timeframe))
}
