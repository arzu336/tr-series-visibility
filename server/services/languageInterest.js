import db from '../db.js'

const ASGARI_OKUNMA = 500
const ASGARI_AY = 3

/**
 * Bir dizinin dil bazında aylık okunma serisi — grafik ve bülten için ham girdi.
 */
export function getSeriesLanguageSeries(tmdbId, { lang } = {}) {
  const sql = lang
    ? 'SELECT lang, year, month, views FROM series_language_interest WHERE tmdb_id = ? AND lang = ? ORDER BY year, month'
    : 'SELECT lang, year, month, views FROM series_language_interest WHERE tmdb_id = ? ORDER BY lang, year, month'
  return lang ? db.prepare(sql).all(tmdbId, lang) : db.prepare(sql).all(tmdbId)
}

/**
 * Verilen ay sayısı kadar geriye giden iki eşit pencereyi karşılaştırır.
 * Dönen `degisimYuzde` null ise iddia kurulamıyor demektir — çağıran taraf bunu "veri yetersiz"
 * diye göstermeli, 0 ya da "değişim yok" diye DEĞİL.
 */
function pencereKarsilastir(satirlar, pencereAy) {
  const sirali = [...satirlar].sort((a, b) => a.year - b.year || a.month - b.month)
  const son = sirali.slice(-pencereAy)
  const onceki = sirali.slice(-pencereAy * 2, -pencereAy)

  const topla = (xs) => xs.reduce((a, b) => a + b.views, 0)
  const sonToplam = topla(son)
  const oncekiToplam = topla(onceki)

  if (son.length < ASGARI_AY || onceki.length < ASGARI_AY) {
    return { sonToplam, oncekiToplam, degisimYuzde: null, yetersiz: 'ay-sayisi' }
  }
  if (sonToplam + oncekiToplam < ASGARI_OKUNMA) {
    return { sonToplam, oncekiToplam, degisimYuzde: null, yetersiz: 'hacim' }
  }
  if (oncekiToplam === 0) {
    return { sonToplam, oncekiToplam, degisimYuzde: null, yetersiz: 'sifir-taban' }
  }
  return {
    sonToplam,
    oncekiToplam,
    degisimYuzde: Math.round(((sonToplam - oncekiToplam) / oncekiToplam) * 1000) / 10,
    yetersiz: null,
  }
}

/**
 * Bülten çekirdeği: son N ayda dil bazında en çok yükselen dizi×dil çiftleri.
 * Yalnızca iddia kurulabilen satırlar döner — yetersiz olanlar ayrı sayılır ki
 * "hiçbir şey bulunamadı" ile "ölçemedik" karışmasın.
 */
export function getRisingSeriesLanguages({ pencereAy = 3, enAz = 10 } = {}) {
  const ciftler = db
    .prepare('SELECT DISTINCT tmdb_id, lang FROM series_language_interest')
    .all()

  const sonuclar = []
  let yetersizSayisi = 0

  for (const c of ciftler) {
    const satirlar = db
      .prepare('SELECT year, month, views FROM series_language_interest WHERE tmdb_id = ? AND lang = ?')
      .all(c.tmdb_id, c.lang)
    const k = pencereKarsilastir(satirlar, pencereAy)
    if (k.degisimYuzde === null) {
      yetersizSayisi++
      continue
    }
    sonuclar.push({ tmdbId: c.tmdb_id, lang: c.lang, ...k })
  }

  sonuclar.sort((a, b) => b.degisimYuzde - a.degisimYuzde)
  return {
    pencereAy,
    yukselenler: sonuclar.filter((s) => s.degisimYuzde >= enAz),
    dusenler: sonuclar.filter((s) => s.degisimYuzde <= -enAz).reverse(),
    olculebilenCift: sonuclar.length,
    yetersizCift: yetersizSayisi,
  }
}

/**
 * "Tarihe ilgi artmış mı" sorusunun doğrudan karşılığı — tema × zaman, dil bazında okunma ile.
 * theme_classifications.id = tmdb_id (insan düzeltmesi varsa o geçerli, AI etiketi değil).
 */
export function getThemeInterestOverTime({ yilDan = 2018 } = {}) {
  return db
    .prepare(
      `SELECT COALESCE(t.override_theme, t.theme) AS tema,
              i.year AS yil,
              COUNT(DISTINCT i.tmdb_id) AS dizi,
              COUNT(DISTINCT i.lang) AS dil,
              SUM(i.views) AS okunma
       FROM series_language_interest i
       JOIN theme_classifications t ON t.id = i.tmdb_id
       WHERE i.year >= ?
       GROUP BY tema, yil
       ORDER BY yil, okunma DESC`
    )
    .all(yilDan)
}

/**
 * Kapsama özeti — veri ne kadar derin, hangi diller var. Arayüzde "elimizde ne var"
 * sorusunu dürüstçe cevaplamak için.
 */
export function getCoverageSummary() {
  const genel = db
    .prepare(
      `SELECT COUNT(DISTINCT tmdb_id) dizi, COUNT(DISTINCT lang) dil,
              COUNT(*) satir, MIN(year * 100 + month) ilk, MAX(year * 100 + month) son
       FROM series_language_interest`
    )
    .get()
  const diller = db
    .prepare(
      `SELECT lang, COUNT(DISTINCT tmdb_id) dizi, SUM(views) okunma
       FROM series_language_interest GROUP BY lang ORDER BY okunma DESC`
    )
    .all()
  return { genel, diller }
}
