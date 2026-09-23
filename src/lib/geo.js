export const COUNTRIES_GEOJSON_URL = '/map/countries-110m.geojson'

const ADM0_A3_TO_ISO2 = {
  FRA: 'FR',
  NOR: 'NO',
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
