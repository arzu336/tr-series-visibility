import { getCoverageSummary, getThemeInterestOverTime, getRisingSeriesLanguages } from '../services/languageInterest.js'

const k = getCoverageSummary()
console.log('KAPSAMA:', k.genel.dizi, 'dizi |', k.genel.dil, 'dil |', k.genel.satir, 'satır |',
  String(k.genel.ilk).slice(0,4)+'-'+String(k.genel.ilk).slice(4), '->',
  String(k.genel.son).slice(0,4)+'-'+String(k.genel.son).slice(4))

console.log('\nTEMA x YIL (okunma):')
const t = getThemeInterestOverTime({ yilDan: 2022 })
const yillar = [...new Set(t.map(r => r.yil))].sort()
const temalar = [...new Set(t.map(r => r.tema))]
console.log('tema'.padEnd(14) + yillar.map(y => String(y).padStart(10)).join(''))
for (const tema of temalar) {
  const satir = yillar.map(y => {
    const r = t.find(x => x.tema === tema && x.yil === y)
    return String(r ? r.okunma : 0).padStart(10)
  }).join('')
  console.log(tema.padEnd(14) + satir)
}

const y = getRisingSeriesLanguages({ pencereAy: 3 })
console.log('\nYÜKSELEN (son 3 ay / önceki 3 ay):', y.yukselenler.length, 'çift |',
  'ölçülebilen:', y.olculebilenCift, '| yetersiz:', y.yetersizCift)
for (const r of y.yukselenler.slice(0, 8)) console.log('  ', r.lang.padEnd(5), ('%'+r.degisimYuzde).padStart(9), ' tmdb='+r.tmdbId, ' ', r.oncekiToplam+' -> '+r.sonToplam)
