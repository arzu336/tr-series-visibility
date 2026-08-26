import { getEnrichedVisibility } from '../data-pipeline.js'

const TOP_SERIES_COUNT = 20
const TOP_COUNTRY_COUNT = 15

// server/services/autoNewsScheduler.js VE server/services/socialEnricher.js AYNI "en popüler 20
// dizi × en yüksek görünürlüğe sahip 15 ülke" taramasını paylaşıyor (kullanıcı talebi) — seçim
// mantığı burada TEK yerde, ikisi de aynı 300 çifti tarar; farklı kriterlerle iki ayrı liste
// üretilmez. Proxy ülkeler (gerçek arama hacmi olmayan, sabit skorlu) hariç tutulur — bunlar için
// "en görünür 15 ülke" sıralaması anlamsız olurdu (bkz. data-pipeline.js'teki aynı ayrım).
export async function getEnrichmentTargets() {
  const { data, raw } = await getEnrichedVisibility()

  const topSeries = [...raw.series]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, TOP_SERIES_COUNT)
    .map((s) => ({ id: s.id, name: s.name }))

  const topCountries = [...data.countries]
    .filter((c) => c.dataSource !== 'proxy')
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_COUNTRY_COUNT)
    .map((c) => c.iso2)

  return { topSeries, topCountries }
}
