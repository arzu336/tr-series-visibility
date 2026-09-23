import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resetPipelineDb } from './pipelineDb.js'
import {
  trustOf,
  yetersiz,
  officialPlatformRecordsFor,
  TRUST_OFFICIAL,
  TRUST_UNOFFICIAL_TELEMETRY,
} from './countrySummary.js'
import { direktifIceriyorMu } from '../llm.js'

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
    expect(direktifIceriyorMu('Korelasyon için en az 3 gözlem gerekli, elde 2 var.')).toBeNull()
  })
})

describe('resmî platform rozeti', () => {
  const tmpDir = path.join(os.tmpdir(), 'gorunurluk-pipeline-test')
  const tmpDb = path.join(tmpDir, `pipeline-${Date.now()}.db`)
  const oncekiYol = process.env.PIPELINE_DB_PATH

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
    const db = new DatabaseSync(tmpDb)
    db.exec(`CREATE TABLE netflix_country_rankings (
      country_iso2 TEXT, tmdb_id INTEGER, show_title TEXT, matched_title TEXT,
      weeks_in_top10 INTEGER, peak_rank INTEGER, rank_score REAL,
      last_week_date TEXT, updated_at TEXT
    )`)
    db.exec("INSERT INTO netflix_country_rankings (country_iso2, tmdb_id, show_title, weeks_in_top10, peak_rank) VALUES ('BR', 95603, 'Kurulus Osman', 4, 3)")
    db.exec("INSERT INTO netflix_country_rankings (country_iso2, tmdb_id, show_title, weeks_in_top10, peak_rank) VALUES ('BR', 74823, 'Cukur', 2, 7)")
    db.close()
    process.env.PIPELINE_DB_PATH = tmpDb
    resetPipelineDb()
  })

  afterAll(() => {
    resetPipelineDb()
    if (oncekiYol === undefined) delete process.env.PIPELINE_DB_PATH
    else process.env.PIPELINE_DB_PATH = oncekiYol
    resetPipelineDb()
    fs.rmSync(tmpDb, { force: true })
  })

  it('gerçek kayıt varsa rozet TETİKLENİR ve sayı doğrudur', () => {
    const sonuc = officialPlatformRecordsFor('BR')
    expect(sonuc.status).toBe('hesaplandi')
    expect(sonuc.value).toBe(2)
    expect(sonuc.trust).toBe(TRUST_OFFICIAL)
  })

  it('kaydı olmayan ülkede rozet TETİKLENMEZ — sıfır uydurulmaz', () => {
    const sonuc = officialPlatformRecordsFor('SO')
    expect(sonuc.status).toBe('hesaplanamaz')
    expect(sonuc.reason).toContain('kaydı yok')
  })

  it('tablo hiç yoksa gerekçe "pipeline çalıştırılmalı" der', () => {
    const bosDb = path.join(tmpDir, `bos-${Date.now()}.db`)
    new DatabaseSync(bosDb).close()
    process.env.PIPELINE_DB_PATH = bosDb
    resetPipelineDb()

    const sonuc = officialPlatformRecordsFor('BR')
    expect(sonuc.status).toBe('hesaplanamaz')
    expect(sonuc.reason).toContain('netflix_pipeline.py')

    process.env.PIPELINE_DB_PATH = tmpDb
    resetPipelineDb()
    fs.rmSync(bosDb, { force: true })
  })
})
