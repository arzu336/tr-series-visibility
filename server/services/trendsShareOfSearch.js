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

// iso2 opsiyonel — TrendsExplorer.jsx'in Kıyaslama Modu KÜRESEL (geo verilmez) çalışır; ülke
// bazlı çağıran countryScoringEngine.js davranışı DEĞİŞMEDEN aynı kalır.
function shareOfSearchCacheKey(iso2, titles) {
  const sorted = titles.map(normalizeTitle).sort()
  return `serp:sos:${iso2 ? iso2.toUpperCase() : 'WW'}:${sorted.join('|')}`
}

async function fetchShareOfSearchRaw(titles, iso2, timeframe) {
  const params = { engine: 'google_trends', q: titles.join(','), date: timeframe, data_type: 'TIMESERIES', hl: 'tr' }
  if (iso2) params.geo = iso2.toUpperCase()
  const data = await serpapiGet(params)

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

  return { iso2: iso2 ? iso2.toUpperCase() : null, titles, timeframe, queriedAt: new Date().toISOString(), items }
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

// --- Bölgesel Üstünlük (ComparisonView.jsx) --------------------------------------------------
// GERÇEK SerpAPI testiyle doğrulandı (2026-09-01): data_type=GEO_MAP_0 BİRDEN FAZLA sorguyu
// kabul ETMİYOR ("Please change the data_type to one that supports multiple queries" hatası) —
// çoklu terimle ülke bazlı karşılaştırma için doğru değer data_type=GEO_MAP (alt çizgisiz).
// Yanıttaki compared_breakdown_by_region[].geo ZATEN iso2 kodu — ayrıca bir ülke-adı→iso2
// eşleştirmesine (resolveIso2FromLabel) gerek yok, gerçek yanıtta doğrulandı.
function regionalBreakdownCacheKey(titles) {
  const sorted = titles.map(normalizeTitle).sort()
  return `serp:regional-breakdown:${sorted.join('|')}`
}

async function fetchRegionalBreakdownRaw(titles, timeframe) {
  const data = await serpapiGet({ engine: 'google_trends', q: titles.join(','), data_type: 'GEO_MAP', date: timeframe, hl: 'tr' })
  const rows = (data.compared_breakdown_by_region || [])
    .map((entry) => ({
      iso2: entry.geo,
      location: entry.location,
      values: titles.map((title) => ({
        title,
        value: entry.values?.find((v) => v.query === title)?.extracted_value ?? 0,
      })),
    }))
    .filter((row) => row.iso2)
  return { titles, timeframe, queriedAt: new Date().toISOString(), rows }
}

/**
 * Seçilen 2-5 dizinin ülke bazında karşılaştırmalı arama PAYI — TEK bir SerpAPI çağrısıyla.
 *
 * ÖNEMLİ ÖLÇEK NOTU (denetim bulgusu D.4-1, canlı veriyle doğrulandı): SerpAPI'nin
 * `compared_breakdown_by_region` alanı MUTLAK ilgi değil, her ülke İÇİNDE karşılaştırılan
 * terimler arasındaki YÜZDE PAYIDIR — önbellekteki gerçek yanıtlarda her ülkenin değerleri
 * toplamı istisnasız 100 çıkıyor. Bu yüzden eski "totalInterest = Σ values" hesabı her ülke
 * için sabit 100 üretiyordu ve ona göre yapılan "en çok ilgi gören ilk 10 ülke" sıralaması
 * hiçbir şey ifade etmiyordu (sıralama fiilen SerpAPI'nin kendi sırasını koruyordu).
 *
 * Artık sıralama, LİSTEDEKİ İLK dizinin o ülkedeki payına göre azalan yapılır — yani
 * "birinci dizi hangi ülkelerde rakiplerine göre en baskın?" sorusunun gerçek cevabı.
 * Ülkeler arası mutlak hacim KARŞILAŞTIRILAMAZ; arayüz de bunu böyle etiketler.
 *
 * countryCountByTitle: o dizinin SIFIR OLMAYAN bir pay aldığı ülke sayısı (erişim/izlenme
 * değil) — aynı yanıttan çıkar, ek çağrı gerektirmez.
 */
export async function getRegionalBreakdown(titles, n = 10, timeframe = 'today 12-m') {
  if (!Array.isArray(titles) || titles.length < 2) {
    throw new Error('Bölgesel Üstünlük için en az 2 dizi adı gerekir')
  }
  if (titles.length > MAX_TERMS) {
    throw new Error(`Bölgesel Üstünlük tek sorguda en fazla ${MAX_TERMS} dizi karşılaştırabilir (${titles.length} verildi)`)
  }
  const key = regionalBreakdownCacheKey(titles)
  const result = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchRegionalBreakdownRaw(titles, timeframe))

  const primaryTitle = titles[0]
  const shareOf = (row, title) => row.values.find((v) => v.title === title)?.value ?? 0
  const allRows = result.rows
  // Sıralama ölçütü: ilk seçilen dizinin o ülkedeki payı (eşitlikte ikinci dizininki, vb.) —
  // sabit 100 olan toplam değil (bkz. yukarıdaki ölçek notu).
  const topRows = [...allRows]
    .sort((a, b) => {
      for (const title of titles) {
        const diff = shareOf(b, title) - shareOf(a, title)
        if (diff !== 0) return diff
      }
      return 0
    })
    .slice(0, n)

  const countryCountByTitle = {}
  for (const title of titles) {
    countryCountByTitle[title] = allRows.filter((row) => shareOf(row, title) > 0).length
  }

  return {
    titles,
    primaryTitle,
    timeframe: result.timeframe,
    queriedAt: result.queriedAt,
    topRows,
    countryCountByTitle,
  }
}
