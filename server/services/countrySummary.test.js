import { describe, it, expect } from 'vitest'
import {
  trustOf,
  yetersiz,
  TRUST_OFFICIAL,
  TRUST_UNOFFICIAL_TELEMETRY,
} from './countrySummary.js'
import { direktifIceriyorMu } from '../llm.js'

// Ülke Odaklı Birleştirme katmanının iki sözleşmesi var ve ikisi de sessizce bozulabilir:
//   1) Resmî kaynakla korsan/telemetri sinyali AYNI güven sınıfında gösterilemez.
//   2) Sistem AKSİYON ÖNERMEZ — karar verici uzmandır. Model bir direktif üretirse bu bir
//      hatadır, "yardımsever bir cümle" değil.

describe('güven sınıfları', () => {
  it('resmî kaynaklar official olarak sınıflanır', () => {
    for (const k of ['tmdb', 'justwatch', 'wikipedia', 'imdb', 'yigm', 'gdelt', 'google-trends']) {
      expect(trustOf(k)).toBe(TRUST_OFFICIAL)
    }
  })

  it('korsan/telemetri kaynakları ayrı sınıfta', () => {
    expect(trustOf('dizilla')).toBe(TRUST_UNOFFICIAL_TELEMETRY)
    expect(trustOf('telegram')).toBe(TRUST_UNOFFICIAL_TELEMETRY)
  })

  it('BİLİNMEYEN kaynak güvenli tarafa düşer (gayriresmî sayılır)', () => {
    // Varsayılan "official" olsaydı, yarın eklenecek yeni bir korsan kaynak sessizce
    // resmî görünürdü. Güvenli varsayılan şüpheliyi işaretlemektir.
    expect(trustOf('yeni-bilinmeyen-kaynak')).toBe(TRUST_UNOFFICIAL_TELEMETRY)
    expect(trustOf(undefined)).toBe(TRUST_UNOFFICIAL_TELEMETRY)
  })
})

describe('hesaplanamaz sentineli', () => {
  it('gerekçeyi taşır — çıplak null dönmez', () => {
    const y = yetersiz('örneklem çok küçük (n=2)')
    expect(y.status).toBe('hesaplanamaz')
    expect(y.reason).toContain('n=2')
  })

  it('sıfırdan ayırt edilebilir', () => {
    // "0" ile "ölçemedik" farklı şeylerdir; arayüz ikisini aynı gösteremesin diye
    // sentinel bir nesne, sayı değil.
    expect(typeof yetersiz('x')).toBe('object')
    expect(yetersiz('x')).not.toBe(0)
  })
})

describe('aksiyon önerisi yasağı (kullanıcı kararı)', () => {
  const YASAK = [
    'Bu pazarda tanıtım faaliyetleri artırılmalı.',
    'Turizm iş birliklerine odaklanılması önerilir.',
    'Bölgeye yönelik bir strateji geliştirilmesi gerekir.',
    'Yayın hakları görüşmelerinin hızlandırılması tavsiye edilir.',
    'Bu ülkede lisanslama çalışması yapılmalıdır.',
  ]

  it.each(YASAK)('direktif yakalanır: %s', (metin) => {
    expect(direktifIceriyorMu(metin)).not.toBeNull()
  })

  const SERBEST = [
    'Brezilya için analiz edilmiş 17 basın taramasının olumlu ton ortalaması %25,3.',
    'Turist girişi serisi mevcut ancak görünürlük serisi aynı aylara ulaşmadığından korelasyon hesaplanamıyor.',
    'Resmî platform Top 10 kaydı bulunmadığından ticari kapsama ölçülemiyor.',
    'Öncü seyahat sinyali 16 haftalık gecikmede negatif yönlü ölçüldü.',
  ]

  it.each(SERBEST)('betimleyici cümle engellenmez: %s', (metin) => {
    expect(direktifIceriyorMu(metin)).toBeNull()
  })

  it('betimleyici bir "gerekli" kullanımı yanlışlıkla direktif sayılmaz', () => {
    // "en az 3 gerekli" bir eşik açıklamasıdır, uzmana verilen bir emir değil.
    expect(direktifIceriyorMu('Korelasyon için en az 3 gözlem gerekli, elde 2 var.')).toBeNull()
  })
})
