import db from '../db.js'
import { getCached, setCached } from '../cache.js'
import { getPipelineDb } from './pipelineDb.js'
import { getVisitorSeries, pickBeforeAfterPair } from './tourismData.js'
import { getTourismLeadingSignalSummary } from './tourismTrendsCollector.js'
import {
  pearsonCorrelation,
  pValueForPearsonR,
  confidenceInterval95,
  differenceInDifferences,
} from './tourismCorrelation.js'
import { suggestControlCountry } from '../control-matching.js'

// --- ÜLKE ODAKLI ÇOKLU VERİ BİRLEŞTİRME KATMANI ------------------------------------------------
// Üç sekmenin (Kültürel / Turizm / İhracat) verisini TEK bir ülke için aynı potada toplar.
//
// TASARIMIN İKİ SERT KURALI
// -------------------------
// 1) BU KATMAN AKSİYON ÖNERMEZ. Ne yapılması gerektiğine dair hiçbir direktif, reçete ya da
//    tavsiye üretilmez — karar verici uzmanın kendisidir. Katman yalnızca "veri ne diyor"
//    sorusunu cevaplar. LLM özeti de aynı kurala tabidir (bkz. llm.js generateCountryDataSummary).
// 2) UYDURMA YOK. Hesaplanamayan her şey `hesaplanamaz` durumuyla ve GEREKÇESİYLE döner;
//    sıfır, boş dizi ya da "veri yok" gibi belirsiz bir değerle değil. Arayüz "Gerçek Veri
//    Bekleniyor" rozetini bu duruma bakarak gösterir.

/**
 * Kaynak güven sınıfları. Resmî kaynaklarla korsan/telemetri sinyallerini AYNI tabloda
 * göstermek, ikisini eşit ağırlıkta sunmak demektir — bu ayrım her veri parçasıyla birlikte
 * taşınır ve raporda görünür.
 */
export const TRUST_OFFICIAL = 'official'
export const TRUST_UNOFFICIAL_TELEMETRY = 'unofficial_telemetry'

// Kaynak adı -> güven sınıfı. Burada OLMAYAN bir kaynak bilinçli olarak gayriresmi sayılır:
// varsayılanın "resmî" olması, yeni bir korsan kaynak eklendiğinde onu sessizce resmî
// gösterirdi. Güvenli varsayılan, şüpheli olanı işaretlemektir.
const KAYNAK_GUVEN = {
  tmdb: TRUST_OFFICIAL,
  justwatch: TRUST_OFFICIAL,
  wikipedia: TRUST_OFFICIAL,
  imdb: TRUST_OFFICIAL,
  yigm: TRUST_OFFICIAL,
  gdelt: TRUST_OFFICIAL,
  'google-trends': TRUST_OFFICIAL,
  'world-bank': TRUST_OFFICIAL,
  netflix: TRUST_OFFICIAL,
  dizilla: TRUST_UNOFFICIAL_TELEMETRY,
  telegram: TRUST_UNOFFICIAL_TELEMETRY,
}

export function trustOf(source) {
  return KAYNAK_GUVEN[source] || TRUST_UNOFFICIAL_TELEMETRY
}

/**
 * Hesaplanamayan bir büyüklüğün dürüst karşılığı. `null` döndürmek yetmez: çağıran taraf
 * "sıfır mı, yok mu, hesaplanamadı mı" ayrımını yapamaz ve arayüz sessizce "—" gösterir.
 */
export function yetersiz(reason) {
  return { status: 'hesaplanamaz', reason }
}

const OK = (value, extra = {}) => ({ status: 'hesaplandi', value, ...extra })

// --- Kanonik kimlik köprüsü --------------------------------------------------------------------
// Modül 2'nin omurgası pipeline.db'de (Python tarafı yazar, Node yalnızca OKUR). Bir dizi burada
// kanonik kimliğe bağlanamıyorsa kimlik UYDURULMAZ — `canonicalId: null` döner ve kademe
// `null` kalır, böylece raporu okuyan kişi o satırın diller arası birleştirilemeyeceğini bilir.
function canonicalIdsByTmdbId() {
  const conn = getPipelineDb()
  if (!conn) return new Map()
  try {
    const rows = conn
      .prepare('SELECT tmdb_id, canonical_id, tier FROM canonical_identity WHERE tmdb_id IS NOT NULL')
      .all()
    return new Map(rows.map((r) => [r.tmdb_id, { canonicalId: r.canonical_id, tier: r.tier }]))
  } catch {
    return new Map()
  }
}

// --- Boyut 1: Kültürel & Dizi Sinyali ----------------------------------------------------------
const mediaByCountryStmt = db.prepare(`
  SELECT series_id, total_news_count, positive_score, negative_score, dominant_sentiment,
         override_sentiment, created_at
  FROM media_sentiment
  WHERE country_iso2 = ?
  ORDER BY total_news_count DESC
`)

/**
 * ÖNEMLİ SINIR: Wikipedia okunma verisi DİL bazlıdır, ülke bazlı DEĞİLDİR (Wikimedia makale
 * başına ülke kırılımı yayınlamıyor). Bu yüzden dil sinyalleri ülke boyutunun içine
 * KARIŞTIRILMAZ; ayrı bir alanda, `geoKind: 'language'` etiketiyle taşınır. Aksi halde rapor
 * "Farsça'da arttı" verisini "İran'da arttı" diye sunardı.
 */
function buildCulturalDimension(iso2, countryRow, kanonik) {
  const taramalar = mediaByCountryStmt.all(iso2)
  const analizli = taramalar.filter(
    (t) => t.dominant_sentiment !== 'yetersiz-veri' && t.positive_score != null
  )

  const mediaTone =
    analizli.length === 0
      ? yetersiz(`${iso2} için analiz edilmiş basın taraması yok (${taramalar.length} tarama denendi)`)
      : OK(
          Math.round((analizli.reduce((s, t) => s + t.positive_score, 0) / analizli.length) * 1000) / 10,
          { sampleSize: analizli.length, unit: 'yuzde-olumlu' }
        )

  const diziler = analizli.slice(0, 10).map((t) => {
    const k = kanonik.get(t.series_id) || {}
    return {
      tmdbId: t.series_id,
      canonicalId: k.canonicalId ?? null,
      canonicalTier: k.tier ?? null,
      newsCount: t.total_news_count,
      positivePct: Math.round(t.positive_score * 1000) / 10,
      // İnsan düzeltmesi varsa o geçerlidir — AI etiketi değil.
      sentiment: t.override_sentiment || t.dominant_sentiment,
    }
  })

  return {
    dominantTheme: countryRow?.dominantTheme ?? null,
    seriesCount: countryRow?.seriesCount ?? null,
    mediaTone,
    scannedSeries: diziler,
    scanCount: taramalar.length,
    sources: [
      { source: 'gdelt', trust: trustOf('gdelt'), note: 'basın taraması' },
      { source: 'tmdb', trust: trustOf('tmdb'), note: 'dizi kataloğu ve tema' },
    ],
  }
}

// --- Boyut 2: Turizm & Destinasyon Etkisi ------------------------------------------------------
/**
 * YİGM turist girişi serisi üzerinden ülkenin kendi DiD/korelasyon durumu. Ekonometrik
 * çekirdek tourismCorrelation.js'ten geliyor — burada YENİDEN yazılmıyor.
 *
 * n<3 iken p-değeri tanımsızdır (df=n-2) ve `pValueForPearsonR` zaten `null` döner; o durum
 * burada `hesaplanamaz` olarak dışarı taşınır, sahte bir anlamlılık iddiası üretilmez.
 */
async function buildTourismDimension(iso2, countryRow) {
  const seri = getVisitorSeries(iso2)
  if (!seri || seri.length === 0) {
    return {
      arrivals: yetersiz(`${iso2} YİGM bülteninde izlenen ülkeler arasında değil`),
      correlation: yetersiz('turist girişi serisi yok — korelasyon hesaplanamaz'),
      didEstimate: yetersiz('turist girişi serisi yok — DiD hesaplanamaz'),
      leadingSignal: leadingSignalFor(iso2),
      sources: [{ source: 'yigm', trust: trustOf('yigm'), note: 'turist giriş istatistikleri' }],
    }
  }

  const ciftler = pickBeforeAfterPair(seri)
  const gorunurluk = countryRow?.score ?? null

  // Pearson: aylık turist sayısı ile o ayki görünürlük arasında — görünürlük zaman serisi
  // yalnızca 2 aylık olduğu için (visibility_history 2026-07'den beri) bu şu an ÇOĞU ülkede
  // hesaplanamaz. Sahte bir r üretmek yerine durum açıkça dışarı veriliyor.
  const aylikDegerler = seri.map((s) => s.visitor_count)
  const correlation =
    aylikDegerler.length < 3
      ? yetersiz(`örneklem çok küçük (n=${aylikDegerler.length}, en az 3 gerekli)`)
      : gorunurluk == null
        ? yetersiz('bu ülke için görünürlük skoru yok')
        : yetersiz(
            'görünürlük zaman serisi turist serisiyle aynı aylara henüz ulaşmadı ' +
              `(turist: ${aylikDegerler.length} ay)`
          )

  let didEstimate = yetersiz('kontrol ülkesi eşleştirilemedi')
  if (ciftler) {
    try {
      const kontrol = await suggestControlCountry(iso2, new Set([iso2]))
      if (kontrol?.iso2) {
        const kontrolSeri = getVisitorSeries(kontrol.iso2)
        const kontrolCift = kontrolSeri?.length ? pickBeforeAfterPair(kontrolSeri) : null
        if (kontrolCift) {
          const did = differenceInDifferences({
            treatmentBefore: ciftler.before.visitor_count,
            treatmentAfter: ciftler.after.visitor_count,
            controlBefore: kontrolCift.before.visitor_count,
            controlAfter: kontrolCift.after.visitor_count,
          })
          didEstimate = OK(Math.round(did * 10) / 10, {
            controlIso2: kontrol.iso2,
            controlReason: kontrol.reason ?? null,
            unit: 'yuzde-puan-fark',
            window: `${ciftler.before.year}-${String(ciftler.before.month).padStart(2, '0')} → ${ciftler.after.year}-${String(ciftler.after.month).padStart(2, '0')}`,
          })
        } else {
          didEstimate = yetersiz(`kontrol ülkesi ${kontrol.iso2} için turist serisi yok`)
        }
      }
    } catch (err) {
      didEstimate = yetersiz(`kontrol ülkesi önerisi alınamadı: ${err.message}`)
    }
  }

  return {
    arrivals: OK(seri[seri.length - 1].visitor_count, {
      monthCount: seri.length,
      latest: `${seri[seri.length - 1].year}-${String(seri[seri.length - 1].month).padStart(2, '0')}`,
    }),
    correlation,
    didEstimate,
    leadingSignal: leadingSignalFor(iso2),
    sources: [{ source: 'yigm', trust: trustOf('yigm'), note: 'turist giriş istatistikleri' }],
  }
}

function leadingSignalFor(iso2) {
  const ozet = getTourismLeadingSignalSummary()
  if (ozet.status !== 'gerçek-veri-mevcut') {
    return yetersiz('öncü turizm sinyali taraması henüz sonuç üretmedi')
  }
  const bu = (ozet.signals || []).filter((s) => s.iso2 === iso2)
  if (bu.length === 0) return yetersiz(`${iso2} öncü sinyal taramasının kapsamında değil`)
  const enGuclu = bu.reduce((a, b) => (Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a))
  return OK(enGuclu.correlation, {
    travelQuery: enGuclu.travelQuery,
    lagWeeks: enGuclu.lagWeeks,
    sampleSize: enGuclu.sampleSize,
    direction: enGuclu.direction,
    criticalR: enGuclu.criticalR,
    significant: enGuclu.significant,
    source: 'google-trends',
    trust: trustOf('google-trends'),
  })
}

// --- Boyut 3: İhracat & Ticari Veri Dengesi ----------------------------------------------------
function buildExportDimension(iso2, countryRow, countries) {
  const sirali = [...countries].sort((a, b) => b.score - a.score)
  const sira = sirali.findIndex((c) => c.iso2 === iso2)

  const conn = getPipelineDb()
  let platformKaydi = yetersiz('resmî platform (Netflix Top 10) verisi henüz toplanmadı')
  if (conn) {
    try {
      const row = conn
        .prepare('SELECT COUNT(*) n FROM netflix_country_rankings WHERE country_iso2 = ?')
        .get(iso2)
      platformKaydi =
        row?.n > 0
          ? OK(row.n, { unit: 'top10-kaydi', source: 'netflix', trust: trustOf('netflix') })
          : yetersiz(`${iso2} için resmî platform Top 10 kaydı yok`)
    } catch {
      /* tablo yoksa yetersiz kalır — rozet uydurulmaz */
    }
  }

  return {
    visibilityScore: countryRow?.score != null ? OK(Math.round(countryRow.score * 10) / 10) : yetersiz('görünürlük skoru yok'),
    globalRank: sira >= 0 ? OK(sira + 1, { outOf: sirali.length }) : yetersiz('ülke sıralamada yok'),
    seriesCount: countryRow?.seriesCount != null ? OK(countryRow.seriesCount) : yetersiz('dizi sayısı bilinmiyor'),
    dataSource: countryRow?.dataSource ?? null,
    officialPlatformRecords: platformKaydi,
    // YAPISAL SINIR — çözülebilir bir eksik değil. Uydurma bir tahmin ASLA üretilmiyor.
    licensingRevenue: yetersiz('ülke bazlı dizi lisans bedelleri kamuya açık değildir'),
    sources: [
      { source: 'tmdb', trust: trustOf('tmdb'), note: 'görünürlük skoru' },
      { source: 'justwatch', trust: trustOf('justwatch'), note: 'yayın sağlayıcı kapsamı' },
    ],
  }
}

// --- Birleştirme -------------------------------------------------------------------------------
function collectTrustClasses(dimensions) {
  const resmi = new Set()
  const gayriresmi = new Set()
  for (const boyut of Object.values(dimensions)) {
    for (const s of boyut.sources || []) {
      ;(s.trust === TRUST_OFFICIAL ? resmi : gayriresmi).add(s.source)
    }
  }
  return { official: [...resmi].sort(), unofficialTelemetry: [...gayriresmi].sort() }
}

/**
 * Raporun okunabilir "neyi bilmiyoruz" listesi. Boş olması, her şeyin bilindiği anlamına gelir;
 * dolu olması eksikliğin GİZLENMEDİĞİ anlamına gelir. İkisi de bilgi taşır.
 */
function collectDataGaps(dimensions) {
  const bosluklar = []
  const gez = (boyut, alanAdi, deger) => {
    if (deger && typeof deger === 'object' && deger.status === 'hesaplanamaz') {
      bosluklar.push({ dimension: boyut, field: alanAdi, reason: deger.reason })
    }
  }
  for (const [boyutAdi, boyut] of Object.entries(dimensions)) {
    for (const [alan, deger] of Object.entries(boyut)) gez(boyutAdi, alan, deger)
  }
  return bosluklar
}

const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * Bir ülke için üç boyutu birleştirir. `llmSummary` BU FONKSİYONDA üretilmez — çağıran taraf
 * (index.js) ister, çünkü LLM çağrısı kota harcar ve veri katmanı onun başarısına bağlı olmamalı.
 */
export async function buildCountryConvergence(iso2, countries, { skipCache = false } = {}) {
  const key = `impact:country-summary:${iso2}`
  if (!skipCache) {
    const cached = getCached(key)
    if (cached) return cached
  }

  const countryRow = countries.find((c) => c.iso2 === iso2) || null
  const kanonik = canonicalIdsByTmdbId()

  const dimensions = {
    cultural: buildCulturalDimension(iso2, countryRow, kanonik),
    tourism: await buildTourismDimension(iso2, countryRow),
    export: buildExportDimension(iso2, countryRow, countries),
  }

  const result = {
    iso2,
    generatedAt: new Date().toISOString(),
    isTracked: countryRow != null,
    dimensions,
    trustClasses: collectTrustClasses(dimensions),
    dataGaps: collectDataGaps(dimensions),
    // Bu katman AKSİYON ÖNERMEZ — sözleşme yanıtın içinde de taşınıyor ki tüketen her istemci
    // (ve ileride bu yanıtı okuyacak her model) bunu bilsin.
    contract: 'objektif-veri-ozeti',
  }
  setCached(key, result, CACHE_TTL_MS)
  return result
}
