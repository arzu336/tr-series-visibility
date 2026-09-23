
const BASIS_LABELS = {
  'internet-kullanicisi': 'milyon internet kullanıcısı',
  nufus: 'milyon kişi (nüfus)',
}

/**
 * @returns {{
 *   status: 'ready' | 'unreliable' | 'unavailable',
 *   valueText: string | null,
 *   denominatorText: string | null,
 *   note: string
 * }}
 */
export function describePerCapita(country) {
  const value = country?.scorePerCapita
  if (value == null || !Number.isFinite(value)) {
    return {
      status: 'unavailable',
      valueText: null,
      denominatorText: null,
      note: 'World Bank demografi verisi bulunmadığı için hesaplanamadı.',
    }
  }

  const basisLabel = BASIS_LABELS[country.perCapitaBasis] || 'bilinmeyen payda'
  const yearText = country.perCapitaYear ? `, ${country.perCapitaYear}` : ''
  const denominatorText = `${basisLabel} başına (World Bank${yearText})`

  const valueText = value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (country.perCapitaReliable === false) {
    return {
      status: 'unreliable',
      valueText,
      denominatorText,
      note:
        'Payda 1 milyonun altında: küçük bir nüfusa bölünen skor yapay olarak yükselir, oran ' +
        'istikrarsızdır. Değer hesaplandı ama harita renk ölçeğine dahil edilmez.',
    }
  }

  return {
    status: 'ready',
    valueText,
    denominatorText,
    note: 'Erişilebilirliği ölçer, izlenmeyi değil.',
  }
}

/** Ham toplam skor — sunucu tam sayıya yakın ondalıklı veriyor, panelde 1 ondalık yeter. */
export function formatTotalScore(score) {
  if (score == null || !Number.isFinite(score)) return '—'
  return score.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}
