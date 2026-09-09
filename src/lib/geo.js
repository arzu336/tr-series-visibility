// Globe3D (3D küre) ve Map2D (2D koroplet) aynı ülke sınırı GeoJSON'unu paylaşır —
// tek bir yerden çekilir, iki haritanın verisi asla birbirinden sapmaz.
//
// Denetim bulgusu B-06: dosya eskiden çalışma zamanında raw.githubusercontent.com'dan
// indiriliyordu. İnternet çıkışı olmayan kurumsal/intranet bir dağıtımda istek sessizce
// başarısız oluyor ve harita sonsuza kadar "yükleniyor" durumunda kalıyordu. Artık dosya
// depoda (public/map/) — uygulama tamamen kendi kendine yeterli.
export const COUNTRIES_GEOJSON_URL = '/map/countries-110m.geojson'

// Denetim bulgusu B-04: Natural Earth 110m veri setinde Fransa, Norveç, KKTC ve Somaliland'ın
// ISO_A2 alanı "-99"dur (canlı veriyle doğrulandı: tam olarak bu 4 kayıt). Haritalar yalnızca
// ISO_A2 ile eşleştirdiği için Fransa ve Norveç HİÇBİR ZAMAN renklenmiyor, tıklanamıyor ve
// dördü de aynı "-99" React key'ini üretiyordu. ADM0_A3 (her zaman dolu) üzerinden geri düşüş:
const ADM0_A3_TO_ISO2 = {
  FRA: 'FR',
  NOR: 'NO',
  // KKTC ve Somaliland'ın ISO-3166-1 alpha-2 kodu YOKTUR (tanınmış devlet değiller). Uydurma
  // bir kod atamak yerine (ör. "XN") olduğu gibi bırakılıyorlar: veri setinde ayrı bir sınır
  // olarak çizilirler ama hiçbir ülke verisiyle eşleşmezler — dürüst davranış budur.
}

/**
 * Bir GeoJSON feature'ının güvenilir ISO2 kodu. Eşleşme yoksa null döner — çağıran taraf
 * bunu "veri yok" olarak ele alır (uydurma bir kod üretilmez).
 */
export function featureIso2(feature) {
  const iso2 = feature?.properties?.ISO_A2
  if (iso2 && iso2 !== '-99') return iso2
  const a3 = feature?.properties?.ADM0_A3
  return ADM0_A3_TO_ISO2[a3] || null
}

// ISO2 kodu OLMAYAN iki sınır (KKTC ve Somaliland) haritada çizilir ama hiçbir ülke verisiyle
// eşleşmez — bu bilinçli (yukarıdaki not). Ancak etiketleri de country-centroids.json'a
// düşemediği için GeoJSON'un İNGİLİZCE adına geri düşüyorlardı: haritada "N. Cyprus" yazıyordu.
// Bu bir veri sorunu değil, etiket sorunu; kod uydurmadan, ADM0_A3 üzerinden Türkçe ad veriliyor.
const ADM0_A3_TO_AD = {
  CYN: 'Kuzey Kıbrıs Türk Cumhuriyeti',
  SOL: 'Somaliland',
}

/**
 * Bir feature için gösterilecek Türkçe ad. Önce ISO2 üzerinden country-centroids.json,
 * sonra ISO2'si olmayanlar için ADM0_A3 tablosu, en son GeoJSON'un kendi adı.
 * İki harita bileşeni de bunu paylaşır — biri güncellenip diğeri eski kalmasın.
 */
export function featureDisplayName(feature, turkishNames) {
  const iso2 = featureIso2(feature)
  if (iso2 && turkishNames[iso2]?.name) return turkishNames[iso2].name
  const a3 = feature?.properties?.ADM0_A3
  return ADM0_A3_TO_AD[a3] || feature?.properties?.NAME || iso2 || '—'
}

export async function fetchCountryGeoJSON() {
  const res = await fetch(COUNTRIES_GEOJSON_URL)
  if (!res.ok) throw new Error(`Ülke sınırı verisi alınamadı (${res.status})`)
  const data = await res.json()
  return data.features
}
