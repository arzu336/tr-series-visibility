import db from '../db.js'
import { chargeCurrentUserForLiveCall } from './liveCallQuota.js'
import { resolveIso2FromLabel } from './countryLookup.js'

// Denetim B-12: çıplak fetch'in undici varsayılan zaman aşımı ~300 sn — takılan bir dış servis
// hem istek işleyicilerini hem SIRALI scheduler zincirini saatlerce bloke edebiliyordu.
const EXTERNAL_TIMEOUT_MS = 15000

// Proje raporu §4.6 "Cache & Performans" — SerpAPI (Trends/Social) için TEK, disiplinli bir
// TTL katmanı. server/serpapi.js, server/regional-interest.js ve server/social-listening.js
// eskiden kendi SÜRESİZ (TTL'siz) tablolarına yazıyordu (trends_cache, regional_interest_cache,
// social_listening_cache — hâlâ db.js'te tanımlı ama artık yazılmıyor/okunmuyor, bkz. oradaki
// not) — "her dizi sadece ilk sorguda kota harcar" güvenliydi ama veri asla tazelenmiyordu.
// Burada onun yerine server/cache.js'in zaten kullandığı genel amaçlı, TTL'li cache_entries
// tablosu paylaşılıyor: aynı "süresi dolmuş mu" mantığı, tek yerde.
// 15 günden 7 güne indirildi (kullanıcı talebi) — bu TTL sadece TALEP ÜZERİNE (kullanıcı bir
// diziyi/oyuncuyu sorguladığında) tetiklendiği için kısaltmak sistemik bir kota çarpanı YARATMAZ,
// sadece gerçek kullanım kadar tazeler (bkz. enrichmentTargets.js'teki kapasite notu — asıl kota
// riski haftalık TOPLU taramalarda, onlar ayrıca dengelendi).
export const TRENDS_TTL_MS = 7 * 24 * 60 * 60 * 1000
// BİLEREK 30 günde kaldı (kullanıcı 7 gün istedi) — Bilgi Grafiği/YouTube fragman verisi haftalık
// değişmiyor VE bu, haftalık toplu taramanın (socialEnricher.js) çift-maliyetli kalemidir (dizi/
// ülke çifti başına 2 çağrı) — burada kısaltmak enrichmentTargets.js'teki 875 kombinasyonluk
// havuzu bütçe dışına iterdi. Kısaltılmayan payı havuz büyümesine (35×25) aktarıldı.
export const SOCIAL_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const TIMESERIES_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 12 aylık geçmiş seri — ertesi gün tekrar çekmenin anlamı yok

function normalizeSeriesKey(seriesName) {
  return seriesName.trim().toLocaleLowerCase('tr')
}

export function trendsCacheKey(seriesName) {
  return `serp:trends:${normalizeSeriesKey(seriesName)}`
}
// actorTrendsCollector.js — AYNI fetchTrendsByCountryRaw'ı (GEO_MAP_0, geo parametresiz — TEK
// çağrıda tüm ülkeler) oyuncu adıyla çağırır. Ayrı bir ad alanı (serp:trends: değil serp:actor-
// trends:) bilerek kullanılıyor — bir oyuncu adı bir dizi adıyla aynı normalize edilmiş metne
// düşerse (nadiren ama imkansız değil) iki farklı özelliğin önbelleği çakışmasın diye.
export function actorTrendsCacheKey(actorName) {
  return `serp:actor-trends:${normalizeSeriesKey(actorName)}`
}
export function regionalCacheKey(seriesName, iso2) {
  return `serp:regional:${normalizeSeriesKey(seriesName)}::${iso2.toUpperCase()}`
}
export function socialCacheKey(seriesName) {
  return `serp:social:${normalizeSeriesKey(seriesName)}`
}
// iso2 opsiyonel — verilmezse KÜRESEL (dünya geneli, geo parametresiz) bir sorguyu temsil eder
// (bkz. TrendsExplorer.jsx'in "Küresel Zaman Serisi" grafiği, fetchTrendsTimeSeriesRaw'daki ilgili not).
export function timeSeriesCacheKey(query, iso2, timeframe) {
  return `serp:timeseries:${iso2 ? iso2.toUpperCase() : 'WW'}:${normalizeSeriesKey(query)}:${timeframe}`
}

const getRawStmt = db.prepare('SELECT value, expires_at, updated_at FROM cache_entries WHERE key = ?')
const upsertStmt = db.prepare(`
  INSERT INTO cache_entries (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at
`)

// server/cache.js'teki getCached() süresi dolmuş kaydı YOK SAYAR (null döner) — burada bilerek
// ham satırı okuyoruz: SerpAPI hata verdiğinde (429/ağ) süresi dolmuş bile olsa eski veriyi
// "stale: true" ile dönebilmek için satırın kendisine ihtiyaç var.
function readRaw(key) {
  const row = getRawStmt.get(key)
  if (!row) return null
  return {
    value: JSON.parse(row.value),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    isFresh: Date.now() <= row.expires_at,
  }
}

function writeRaw(key, value, ttlMs, now = Date.now()) {
  upsertStmt.run(key, JSON.stringify(value), now + ttlMs, now)
}

/**
 * Cache-First Stratejisi:
 * 1. Taze (expires_at geçmemiş) kayıt varsa SerpAPI'ye hiç gitmeden onu döner.
 * 2. Yoksa/süresi dolmuşsa fetchFn() çağrılır; başarılıysa yeni TTL ile yazılır.
 * 3. fetchFn() başarısız olursa (429 kota, ağ hatası, timeout) — süresi dolmuş bile olsa bir
 *    kayıt varsa çökmeden onu `stale:true` ile döner. Hiç kayıt yoksa hatayı olduğu gibi
 *    yukarı fırlatır (çağıran route'un mevcut try/catch → 502 davranışı korunur).
 */
export async function cacheFirstSerpApi(key, ttlMs, fetchFn) {
  const cached = readRaw(key)
  if (cached && cached.isFresh) {
    return { ...cached.value, fromCache: true, stale: false }
  }

  try {
    const fresh = await fetchFn()
    writeRaw(key, fresh, ttlMs)
    return { ...fresh, fromCache: false, stale: false }
  } catch (err) {
    if (cached) {
      console.error(
        `[serpApiCache] "${key}" için canlı istek başarısız (${err.message}) — süresi dolmuş önbellek stale:true ile kullanılıyor.`
      )
      return { ...cached.value, fromCache: true, stale: true, staleReason: err.message }
    }
    throw err
  }
}

// --- Aylık kota bütçesi ----------------------------------------------------------------------
// Onaylanan plan 5.000 sorgu/ay (2026-08-26, kullanıcı teyidi — server/scheduler.js'teki eski
// "250 sorgu/ay" notu artık GÜNCEL DEĞİL). autoNewsScheduler/tourismTrendsCollector/
// socialEnricher gibi haftalık toplu taramalar bu paylaşılan havuzu on-demand kullanımla (kullanıcı
// tetiklemeli /api/trends, /api/social/:seriesName vb.) BÖLÜŞÜYOR — tek bir merkezi sayaç, meta
// tablosunda "serpApiUsage:YYYY-MM" anahtarıyla, ay değişince otomatik sıfırlanır (yeni anahtar).
// Sınır aşılırsa GERÇEK bir 429 ile AYNI hata mesajı fırlatılır ki zaten var olan tüm
// cache-first/stale-fallback yolları (cacheFirstSerpApi, newsSentiment.js) hiçbir ek kod
// gerekmeden bunu da bir "kota doldu" durumu gibi zarifçe yönetsin.
//
// SERPAPI_API_KEY'in aşağıdaki serpapiGet() içinde (modül üst seviyesinde DEĞİL) okunmasıyla AYNI
// sebep: server/index.js'te dotenv.config() diğer TÜM import'lardan SONRA çalışıyor (import'lar
// hoisted) — process.env.SERPAPI_MONTHLY_BUDGET modül yüklenirken okunsaydı .env'deki değer HİÇ
// görülmezdi, hep varsayılana düşerdi. Fonksiyon gövdesinde (çağrı anında) okunarak bu kaçırılıyor.
function getSerpApiMonthlyBudget() {
  return Number(process.env.SERPAPI_MONTHLY_BUDGET) || 5000
}

function currentUsageMonthKey(now = new Date()) {
  return `serpApiUsage:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?')

// Eskiden "SELECT mevcut değer → JS'te +1 → UPDATE" iki ayrı adımdı — serpapiGet() bir `await
// fetch(...)`nin (asenkron, event loop'a devrediyor) ETRAFINDA çalıştığı için, iki eşzamanlı
// çağrı aynı eski değeri okuyup ikisi de aynı yeni değere yazabiliyordu (kayıp güncelleme/TOCTOU
// — ComparisonView.jsx'in tek "Karşılaştır" tıklamasında bile art arda birden fazla SerpAPI
// çağrısı tetiklediği düşünülürse gerçek bir risk). Aşağıdaki TEK SQL ifadesi (INSERT ... ON
// CONFLICT ... RETURNING) hem artırıyor hem yeni değeri aynı anda döndürüyor — node:sqlite'ın
// DatabaseSync'i senkron/bloklayıcı olduğu için bu tek çağrı sırasında başka hiçbir JS kodu
// araya giremez, yarış durumu yapısal olarak imkânsız hâle gelir (gerçek testle doğrulandı).
const reserveUsageStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
  RETURNING CAST(value AS INTEGER) AS value
`)
const releaseUsageStmt = db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) - 1 WHERE key = ?`)

export function getSerpApiUsageThisMonth(now = new Date()) {
  const monthKey = currentUsageMonthKey(now)
  const row = getMetaStmt.get(monthKey)
  return { used: row ? Number(row.value) : 0, budget: getSerpApiMonthlyBudget() }
}

// --- SerpAPI düşük seviye istek yardımcıları -----------------------------------------------
// server/serpapi.js, server/regional-interest.js, server/social-listening.js ve
// server/services/trendsShareOfSearch.js'in tekrarladığı 429/hata işleme mantığı burada TEK yerde.
export async function serpapiGet(params) {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY tanımlı değil (.env dosyasını kontrol et)')
  }

  // Rezervasyon, gerçek isteği atmadan (async fetch'ten) ÖNCE ve atomik olarak yapılır — "önce
  // kontrol et, sonra artır" sırası TERSİNE çevrildi (artık "önce artır, sonucu kontrol et").
  // Bütçe aşılırsa VEYA istek herhangi bir sebeple başarısız olursa rezervasyon geri alınır
  // (releaseUsageStmt) — başarısız/atılmamış bir çağrı kotadan düşmez, önceki davranışla aynı.
  const monthKey = currentUsageMonthKey()
  const budget = getSerpApiMonthlyBudget()
  const reserved = reserveUsageStmt.get(monthKey).value
  if (reserved > budget) {
    releaseUsageStmt.run(monthKey)
    // Kota hataları rota katmanında jenerik 502'ye dönüşmesin diye açıkça işaretleniyor
    // (bkz. index.js sendUpstreamError): kullanıcı "dış servise ulaşılamıyor" değil, "kota doldu"
    // görmeli — ikisi tamamen farklı eylemler gerektirir.
    const kotaHatasi = new Error(`Aylık kota dolmuş görünüyor (429). (${reserved - 1}/${budget})`)
    kotaHatasi.status = 429
    throw kotaHatasi
  }

  // Kurum bütçesinin yanına KULLANICI BAŞINA günlük sınır (denetim G-01/B-15). Buraya
  // gelinmişse gerçekten dışarıya çıkan bir çağrı yapılacak demektir — önbellekten dönen
  // istekler serpapiGet'e hiç uğramadığı için ücretsiz kalmaya devam eder.
  let releaseUserCall
  try {
    releaseUserCall = chargeCurrentUserForLiveCall()
  } catch (err) {
    releaseUsageStmt.run(monthKey)
    throw err
  }

  try {
    const url = new URL('https://serpapi.com/search.json')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('api_key', apiKey)

    const res = await fetch(url, { signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS) })
    if (!res.ok) {
      if (res.status === 429) {
        const kotaHatasi = new Error('Aylık kota dolmuş görünüyor (429).')
        kotaHatasi.status = 429
        throw kotaHatasi
      }
      throw new Error(`İstek başarısız (${res.status})`)
    }
    const data = await res.json()
    if (data.error) {
      throw new Error(`İstek hatası: ${data.error}`)
    }
    return data
  } catch (err) {
    // Başarısız çağrı ne kurum bütçesinden ne de kullanıcının günlük kotasından düşer.
    releaseUsageStmt.run(monthKey)
    releaseUserCall()
    throw err
  }
}

// Ham (cache'siz) Google Trends çağrısı — queryTrends (serpapi.js) VE calculateRegionalScore
// AYNI cache anahtarını (trendsCacheKey) kullandığı için tek bir SerpAPI isteği ikisine de
// hizmet eder, kota iki kat harcanmaz.
export async function fetchTrendsByCountryRaw(seriesName) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: seriesName,
    data_type: 'GEO_MAP_0',
    hl: 'tr',
  })
  // Denetim bulgusu B-13: eskiden `r.location || r.geo` idi — yani SerpAPI'nin hl=tr'ye göre
  // YERELLEŞTİRDİĞİ ülke ADI birincil anahtardı ve aşağıda resolveIso2FromLabel ile ada göre
  // eşleştiriliyordu. Ad eşleşmesi kırılgan: yazım farkı ("Bosna-Hersek" vs "Bosna Hersek") ya da
  // country-centroids.json'da bulunmayan bir ülke sessizce DÜŞÜYORDU. Ölçüldü: önbellekteki 39
  // trends kaydında 12 ülke kayboluyordu (İran 35, Türkmenistan 28, Kosova 8 kez...).
  // `r.geo` zaten ISO2 kodudur — ad çevirisine hiç girmeden doğru anahtarı verir; `location`
  // yalnızca geo boşsa geri düşüş olarak kalır.
  // DİKKAT: bu tercih SADECE ülke düzeyi (GEO_MAP_0, dünya geneli) yanıtlar için doğrudur.
  // fetchRegionalInterestRaw ülke İÇİ alt bölge döndürür ve orada `geo` "US-WY" gibi bir alt
  // bölge kodudur; oradaki `location` (ör. "Wyoming", "Kaliforniya") doğrudan ekrana basıldığı
  // için bilerek DEĞİŞTİRİLMEDİ.
  const byCountry = (data.interest_by_region || [])
    .map((r) => ({ country: r.geo || r.location, value: r.extracted_value ?? r.value }))
    .filter((r) => r.country != null && r.value != null)
    .sort((a, b) => b.value - a.value)

  return { seriesName, queriedAt: new Date().toISOString(), byCountry }
}

// Öncü seyahat sinyali (bkz. server/services/tourismCorrelation.js) — bir terimin (dizi adı ya
// da "Istanbul") belirli bir ülkedeki HAFTALIK arama ilgisi zaman serisi. GEO_MAP_0'dan farklı:
// tek bir ülkeye/tek bir terime sabitlenip data_type=TIMESERIES ile gerçek bir 12 aylık geçmiş
// döner (gerçek test: 2026-08-26, İspanya'da "Istanbul" için 53 haftalık, gerçek mevsimsel
// varyasyonlu — yaz aylarında zirve — bir seri; "Turkey Travel" terimi aynı ülkede neredeyse
// sürekli 0 çıktı, bu yüzden öncü gösterge için "Istanbul" tercih edilir).
// iso2 opsiyonel — verilmezse SerpAPI'ye hiç geo parametresi gönderilmez, bu da Google
// Trends'te "Worldwide" (dünya geneli) sonucu anlamına gelir. TrendsExplorer.jsx'in "Küresel
// Zaman Serisi" grafiği bunu kullanır; tourismCorrelation.js'in ülkeye özel öncü göstergesi
// (her zaman gerçek bir iso2 geçer) davranışı DEĞİŞMEDEN aynı kalır.
export async function fetchTrendsTimeSeriesRaw(query, iso2, timeframe = 'today 12-m') {
  const params = { engine: 'google_trends', q: query, date: timeframe, data_type: 'TIMESERIES', hl: 'tr' }
  if (iso2) params.geo = iso2.toUpperCase()
  const data = await serpapiGet(params)
  const timeline = (data.interest_over_time?.timeline_data || [])
    .filter((point) => !point.partial_data) // son (tamamlanmamış) hafta gerçek bir veri noktası değil
    .map((point) => ({
      timestamp: point.timestamp ? Number(point.timestamp) : null,
      value: point.values?.[0]?.extracted_value ?? 0,
    }))
    .filter((point) => point.timestamp != null)

  return { query, iso2: iso2 ? iso2.toUpperCase() : null, timeframe, queriedAt: new Date().toISOString(), timeline }
}

export async function fetchRegionalInterestRaw(seriesName, iso2) {
  const data = await serpapiGet({
    engine: 'google_trends',
    q: seriesName,
    data_type: 'GEO_MAP_0',
    geo: iso2.toUpperCase(),
    hl: 'tr',
  })
  const byRegion = (data.interest_by_region || [])
    .map((r) => ({ region: r.location || r.geo, value: r.extracted_value ?? r.value }))
    .filter((r) => r.region != null && typeof r.value === 'number')
    .sort((a, b) => b.value - a.value)

  return { queriedAt: new Date().toISOString(), byRegion }
}

// GERÇEK yanıtla doğrulandı (2026-08-26, "Diriliş: Ertuğrul" / TR ve ES sorguları): Google'ın
// google_news dışındaki bu "google" motorunda puanlar knowledge_graph.ratings'te DEĞİL,
// web_results içindeki title="Ratings" olan girdinin .ratings alanında geliyor — eski kod
// (kg.ratings) bu yüzden neredeyse hiç sonuç bulamıyordu, burada düzeltildi. "Yerel yayın
// platformu" için de gerçek alan knowledge_graph.watch_now (ör. "Prime Video") — bazı
// sonuçlarda o da yok, o zaman web_results'taki "Where to watch" girdisine düşülür. user_reviews
// (Google izleyici beğeni yüzdesi) her iki gerçek testte de YOKTU — dizi türü sonuçlarda nadiren
// dolduğu için opsiyonel okunur, uydurma bir değer asla üretilmez.
function extractRatingsFromKg(kg) {
  const ratingsEntry = (kg.web_results || []).find((w) => Array.isArray(w.ratings) && w.ratings.length > 0)
  return ratingsEntry ? ratingsEntry.ratings.map((r) => ({ source: r.source, rating: r.rating, link: r.link || null })) : []
}

function extractWatchPlatforms(kg) {
  if (Array.isArray(kg.watch_now) && kg.watch_now.length > 0) {
    return kg.watch_now.map((w) => ({ name: w.name, link: w.link || null }))
  }
  const whereToWatch = (kg.web_results || []).find((w) => /where to watch/i.test(w.title || ''))
  if (whereToWatch?.link) {
    return [{ name: whereToWatch.source || whereToWatch.title, link: whereToWatch.link }]
  }
  return []
}

async function fetchKnowledgeGraphRaw(seriesName) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} dizi`, hl: 'tr', gl: 'tr' })
  const kg = data.knowledge_graph
  if (!kg) return null
  const ratings = extractRatingsFromKg(kg)
  const userReviewsPct = kg.user_reviews?.percentage ?? null
  // Eskiden SADECE puan varsa nesne dönülüyordu — user_reviews puanlardan bağımsız gelebiliyor
  // (gerçek testte ikisi de nadiren aynı anda dolu), o yüzden ikisi de boşsa dürüstçe null.
  if (ratings.length === 0 && userReviewsPct == null) return null
  return { title: kg.title || seriesName, ratings, userReviewsPct }
}

// Feature 3 (server/services/socialEnricher.js) — fetchKnowledgeGraphRaw'ın aksine hedef ÜLKEYE
// göre yerelleştirilir (gl parametresi, Türkiye'ye sabit değil) ve ayrıca yayın platformunu +
// (varsa) izleyici beğeni yüzdesini döner. Sorgu kasıtlı olarak İngilizce "tv series" — "dizi"
// kelimesi Türkçe'ye özgü, yabancı gl'lerde Google'ın doğru Bilgi Grafiği'ni tetiklemesi daha
// güvenilir (gerçek testte ES için çalıştığı doğrulandı).
export async function fetchLocalizedKnowledgeGraphRaw(seriesName, iso2) {
  const data = await serpapiGet({ engine: 'google', q: `${seriesName} tv series`, gl: iso2.toLowerCase() })
  const kg = data.knowledge_graph
  if (!kg) return null
  return {
    title: kg.title || seriesName,
    watchPlatforms: extractWatchPlatforms(kg),
    ratings: extractRatingsFromKg(kg),
    userReviewsPct: kg.user_reviews?.percentage ?? null,
  }
}

// "fragman" yerine kasıtlı olarak İngilizce "trailer" — hedef ülkede Türkçe aramanın resmi
// fragmanı bulma ihtimali düşük, İngilizce altyazılı/dublajlı resmi fragmanlar uluslararası
// izleyiciye daha çok hitap ediyor (gerçek testte ES/gl için TRT Drama English kanalının resmi
// fragmanı doğru şekilde döndü, doğrulandı).
export async function fetchLocalizedYouTubeRaw(seriesName, iso2) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} trailer`, gl: iso2.toLowerCase() })
  const top = (data.video_results || [])[0]
  if (!top) return null
  return {
    title: top.title,
    channel: top.channel?.name || null,
    channelVerified: Boolean(top.channel?.verified),
    views: top.views ?? null,
    publishedDate: top.published_date || null,
    link: top.link,
    thumbnail: top.thumbnail?.static || null,
  }
}

export function localizedSocialCacheKey(seriesName, iso2) {
  return `serp:social-local:${normalizeSeriesKey(seriesName)}::${iso2.toUpperCase()}`
}

// Denetim bulgusu B-05: bu iki fonksiyon alt çağrı hatalarını `{error}` nesnesine çevirip
// döndürüyordu; cacheFirstSerpApi bunu BAŞARILI bir sonuç sanıp 30 GÜN kalıcı yazıyordu. Sonuç:
// "kota doldu"/"anahtar yok" gibi geçici bir hata bir ay boyunca "taze veri" gibi davranıyor,
// socialEnricher `fromCache:true` görüp bir daha denemiyordu. Yeni davranış:
//   - hata `{error}` olarak ASLA kalıcı yazılmaz (null'a çevrilir),
//   - İKİ yarı da başarısızsa fırlatılır → cacheFirstSerpApi hiçbir şey yazmaz, varsa eski
//     (stale) kaydı döndürür; yoksa hata yukarı çıkar,
//   - yalnızca biri başarısızsa diğerinin gerçek verisi normal TTL ile yazılır (yarısı boş bir
//     kayıt, hiç kayıt olmamasından iyidir ve bir sonraki turda tazelenir).
function settleHalf(result) {
  if (result.status === 'fulfilled') return { value: result.value, error: null }
  return { value: null, error: result.reason?.message || String(result.reason) }
}

function combineSocialHalves(base, kgResult, ytResult) {
  const kg = settleHalf(kgResult)
  const yt = settleHalf(ytResult)
  if (kg.error && yt.error) {
    throw new Error(`Sosyal dinleme çağrılarının ikisi de başarısız: ${kg.error} / ${yt.error}`)
  }
  return { ...base, queriedAt: new Date().toISOString(), knowledgeGraph: kg.value, youtube: yt.value }
}

export async function fetchLocalizedSocialListeningRaw(seriesName, iso2) {
  const [kgResult, ytResult] = await Promise.allSettled([
    fetchLocalizedKnowledgeGraphRaw(seriesName, iso2),
    fetchLocalizedYouTubeRaw(seriesName, iso2),
  ])
  return combineSocialHalves({ seriesName, iso2: iso2.toUpperCase() }, kgResult, ytResult)
}

// "fragman" sorgusu genelde en yüksek izlenmeli sonuç olarak "1. Bölüm Fragmanı" (tek bölümlük,
// eski bir teaser) döndürüyor — gerçek testte doğrulandı (Esaret, 2026-09-01). Kullanıcı talebi:
// dizinin GENEL tanıtımı, tek bir bölümün fragmanı değil. Sorgu "dizi tanıtım"a çevrildi VE
// başlığı "N. Bölüm" ile eşleşen (bölüme özel) sonuçlar elenip ilk KALAN sonuç alınıyor — YouTube/
// SerpAPI'nin kendi alaka sıralaması korunuyor, sadece bölüm-özel teaser'lar geriye itiliyor.
// Gerçek testte doğrulandı: bu, "1. Bölüm Fragmanı" yerine "3. Sezon İlk Fragman" gibi genel bir
// sezon/dizi tanıtımına düşüyor. Hepsi bölüme özelse (nadiren), dürüstçe ilk sonuca düşülür —
// hiç video göstermemek yerine.
const EPISODE_SPECIFIC_TITLE_RE = /\d+\.\s*bölüm/i

async function fetchYouTubeRaw(seriesName) {
  const data = await serpapiGet({ engine: 'youtube', search_query: `${seriesName} dizi tanıtım` })
  const results = data.video_results || []
  const top = results.find((v) => !EPISODE_SPECIFIC_TITLE_RE.test(v.title || '')) || results[0]
  if (!top) return null
  return {
    title: top.title,
    channel: top.channel?.name || null,
    channelVerified: Boolean(top.channel?.verified),
    views: top.views ?? null,
    publishedDate: top.published_date || null,
    link: top.link,
    thumbnail: top.thumbnail?.static || null,
  }
}

export async function fetchSocialListeningRaw(seriesName) {
  const [kgResult, ytResult] = await Promise.allSettled([
    fetchKnowledgeGraphRaw(seriesName),
    fetchYouTubeRaw(seriesName),
  ])
  return combineSocialHalves({ seriesName }, kgResult, ytResult)
}

// Denetim raporu D.6: `google_news` motorunu kullanan fetchNewsArticlesRaw BURADAN KALDIRILDI.
// Haber taraması artık ücretsiz GDELT DOC 2.0 üzerinden yapılıyor (services/gdeltNews.js) —
// rapora göre aylık ~1.875 ücretli çağrılık en büyük SerpAPI kalemi buydu. Fonksiyon dışa açık
// bırakılsaydı ileride yanlışlıkla yeniden kullanılıp sessizce ücretli çağrı açabilirdi; ölü kod
// olarak durmasın diye tamamen silindi. Bu dosyadaki DİĞER motorlar (google_trends, google,
// youtube) olduğu gibi kalıyor.

// --- Hibrit Yerel Skor Çarpanı ---------------------------------------------------------------
// TMDB'nin popülerlik alanı TEK bir küresel sayı (bkz. server/series-period-history.js'teki aynı
// prensip) — ülke bazlı gerçek bir "bu ülkede ne kadar popüler" sinyali yok. Burada, Google
// Trends'in o dizi için döndürdüğü ÜLKE BAZLI arama ilgisiyle (0-100, GEO_MAP_0) TMDB'nin global
// skorunu ağırlıklandırıp ülkeye özgü bir yaklaşık skor üretiyoruz. Bu KESİN bir "o ülkede gerçek
// izleyici sayısı" değil — arama ilgisi bazlı bir TÜREV skor (bkz. Netflix/ReytingTV
// modüllerindeki "rank_score gerçek reyting değildir" prensibiyle aynı dürüstlük).
export async function calculateRegionalScore(basePopularity, countryIso2, seriesName) {
  const key = trendsCacheKey(seriesName)
  const trends = await cacheFirstSerpApi(key, TRENDS_TTL_MS, () => fetchTrendsByCountryRaw(seriesName))

  const iso2 = countryIso2.toUpperCase()
  const match = (trends.byCountry || []).find((r) => resolveIso2FromLabel(r.country) === iso2)

  if (!match) {
    // Google Trends o ülke için hiç veri döndürmemiş — uydurma bir çarpan uygulamak yerine
    // dürüstçe nötr (1.0) çarpanla TMDB skorunu olduğu gibi döneriz.
    return {
      score: basePopularity,
      multiplier: 1,
      localInterest: null,
      basis: 'yetersiz-veri',
      fromCache: trends.fromCache,
      stale: trends.stale,
    }
  }

  // 0-100 arası Trends ilgisini 0.5–1.5 arası bir çarpana eşliyoruz: hiç ilgi yoksa (0) skor
  // yarıya iner, maksimum ilgide (100) %50 artar — TMDB'nin küresel skorunu tamamen geçersiz
  // kılmadan (o da gerçek bir sinyal) yerel ilgiyle dengeler.
  const multiplier = 0.5 + match.value / 100
  const score = Math.round(basePopularity * multiplier * 10) / 10

  return {
    score,
    multiplier: Math.round(multiplier * 100) / 100,
    localInterest: match.value,
    basis: 'google-trends',
    fromCache: trends.fromCache,
    stale: trends.stale,
  }
}

// --- Eski (TTL'siz) önbelleklerden tek seferlik geçiş -----------------------------------------
// Zaten harcanmış SerpAPI kotasıyla çekilmiş veriyi (trends_cache/regional_interest_cache/
// social_listening_cache) kaybetmemek için — bu üç tablo artık yazılmıyor ama içindeki veri
// cache_entries'e taşınır. queried_at bazlı gerçek "ne kadar eski" hesaplanır (expires_at
// geçmişte de çıkabilir — o durumda satır zaten stale sayılır, sorun değil, ilk istekte
// normal şekilde tazelenir). `meta` tablosundaki bayrakla SADECE BİR KEZ çalışır.
function migrateLegacySerpApiCaches() {
  const metaKey = 'serpApiCacheLegacyMigratedAt'
  const already = db.prepare('SELECT value FROM meta WHERE key = ?').get(metaKey)
  if (already) return

  let migrated = 0

  for (const row of db.prepare('SELECT key, series_name, queried_at, by_country FROM trends_cache').all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts) || !row.by_country) continue
    upsertStmt.run(
      `serp:trends:${row.key}`,
      JSON.stringify({ seriesName: row.series_name, queriedAt: row.queried_at, byCountry: JSON.parse(row.by_country) }),
      ts + TRENDS_TTL_MS,
      ts
    )
    migrated++
  }

  for (const row of db
    .prepare('SELECT key, series_name, iso2, queried_at, by_region FROM regional_interest_cache')
    .all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts) || !row.by_region) continue
    upsertStmt.run(
      `serp:regional:${row.key}`,
      JSON.stringify({ queriedAt: row.queried_at, byRegion: JSON.parse(row.by_region) }),
      ts + TRENDS_TTL_MS,
      ts
    )
    migrated++
  }

  for (const row of db
    .prepare('SELECT key, series_name, queried_at, knowledge_graph, youtube FROM social_listening_cache')
    .all()) {
    const ts = Date.parse(row.queried_at)
    if (Number.isNaN(ts)) continue
    upsertStmt.run(
      `serp:social:${row.key}`,
      JSON.stringify({
        seriesName: row.series_name,
        queriedAt: row.queried_at,
        knowledgeGraph: row.knowledge_graph ? JSON.parse(row.knowledge_graph) : null,
        youtube: row.youtube ? JSON.parse(row.youtube) : null,
      }),
      ts + SOCIAL_TTL_MS,
      ts
    )
    migrated++
  }

  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    metaKey,
    String(Date.now())
  )
  if (migrated > 0) {
    console.log(`[serpApiCache] ${migrated} eski SerpAPI önbellek kaydı cache_entries'e taşındı.`)
  }
}

migrateLegacySerpApiCaches()
