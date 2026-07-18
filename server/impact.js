// Turist girişi ve ihracat rakamları örnek/açıklayıcıdır (bkz. rapor §4.4 — TÜİK ve
// Kültür ve Turizm Bakanlığı ham verisi kurumsal talep gerektirir, kamuya açık bir API yok).
// Aşağıdaki hesaplama mantığı (DiD düzeltmesi, Pearson korelasyonu, güven aralığı) gerçek
// istatistik yöntemidir — rapor §4.5 ve §8.1'de tanımlanan metodolojinin birebir uygulanmasıdır.
const CASES = [
  {
    country: 'İspanya',
    controlCountry: 'İtalya',
    theme: 'Aile / Aşk',
    visibilityChangePct: 32,
    rawTourismChangePct: 14,
    controlTourismChangePct: 6,
    rawExportChangePct: 8,
    controlExportChangePct: 3,
    windowMonths: 6,
  },
  {
    country: 'Meksika',
    controlCountry: 'Kolombiya',
    theme: 'Adalet / Aile',
    visibilityChangePct: 18,
    rawTourismChangePct: 9,
    controlTourismChangePct: 4,
    rawExportChangePct: 5,
    controlExportChangePct: 2,
    windowMonths: 6,
  },
  {
    country: 'Suudi Arabistan',
    controlCountry: 'Birleşik Arap Emirlikleri',
    theme: 'Göç / Adalet',
    visibilityChangePct: 40,
    rawTourismChangePct: 21,
    controlTourismChangePct: 9,
    rawExportChangePct: 12,
    controlExportChangePct: 5,
    windowMonths: 6,
  },
  {
    country: 'Sırbistan',
    controlCountry: 'Hırvatistan',
    theme: 'Aile',
    visibilityChangePct: 22,
    rawTourismChangePct: 11,
    controlTourismChangePct: 5,
    rawExportChangePct: 6,
    controlExportChangePct: 2,
    windowMonths: 6,
  },
  {
    country: 'Şili',
    controlCountry: 'Arjantin',
    theme: 'Aşk / Aile',
    visibilityChangePct: 15,
    rawTourismChangePct: 7,
    controlTourismChangePct: 3,
    rawExportChangePct: 4,
    controlExportChangePct: 2,
    windowMonths: 6,
  },
]

// Difference-in-Differences: hedef ülkenin ham değişiminden kontrol ülkesinin (ortak
// makro/mevsimsel etkiyi temsil eden) değişimini çıkarır (rapor §4.5).
function applyDiD(c) {
  return {
    ...c,
    isIllustrative: true,
    adjustedTourismChangePct: round1(c.rawTourismChangePct - c.controlTourismChangePct),
    adjustedExportChangePct: round1(c.rawExportChangePct - c.controlExportChangePct),
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

export function pearsonCorrelation(xs, ys) {
  const n = xs.length
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? 0 : num / denom
}

// Fisher z dönüşümüyle %95 güven aralığı. n küçükken aralık geniş çıkar — bu, küçük
// örneklemin dürüst bir yansımasıdır (rapor §8.1: "nedensellik değil ilişki gücü").
export function confidenceInterval95(r, n) {
  if (n < 4) return null
  const clamped = Math.max(-0.9999, Math.min(0.9999, r))
  const z = 0.5 * Math.log((1 + clamped) / (1 - clamped))
  const se = 1 / Math.sqrt(n - 3)
  const zLo = z - 1.96 * se
  const zHi = z + 1.96 * se
  const toR = (zVal) => (Math.exp(2 * zVal) - 1) / (Math.exp(2 * zVal) + 1)
  return { low: round2(toR(zLo)), high: round2(toR(zHi)) }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function buildCorrelation(cases, key) {
  const xs = cases.map((c) => c.visibilityChangePct)
  const ys = cases.map((c) => c[key])
  const r = round2(pearsonCorrelation(xs, ys))
  return { r, n: cases.length, ci95: confidenceInterval95(r, cases.length) }
}

export function buildImpactReport() {
  const cases = CASES.map(applyDiD)
  return {
    cases,
    correlations: {
      tourism: buildCorrelation(cases, 'adjustedTourismChangePct'),
      export: buildCorrelation(cases, 'adjustedExportChangePct'),
    },
  }
}
