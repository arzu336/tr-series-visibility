// Globe3D (3D küre) ve Map2D (2D koroplet) aynı ülke sınırı GeoJSON'unu paylaşır —
// tek bir yerden çekilir, iki haritanın verisi asla birbirinden sapmaz.
export const COUNTRIES_GEOJSON_URL =
  'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'

export async function fetchCountryGeoJSON() {
  const res = await fetch(COUNTRIES_GEOJSON_URL)
  const data = await res.json()
  return data.features
}
