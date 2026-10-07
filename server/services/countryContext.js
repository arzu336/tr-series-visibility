import db from '../db.js'
import { getForeignStudentSummary } from './foreignStudents.js'
import { getAllOwnRankings } from './charts.js'

// Yayın kataloğu olmayan ülkelerin paneli (2026-10-06): boş bölümler yerine eldeki veri — Türkiye'de okuyan
// öğrenci sayısı, basın taraması özeti ve (bağımlı bölgelerde) bağlı olduğu ülkenin bu haftaki sıralaması.

// Kendi yayın kataloğu olmayan bağımlı bölgeler → bağlı oldukları ülke (yayın platformları çoğunlukla o ülkenin
// kataloğunu sunar). Çok küçük bölgeler (Cebelitarık, Guernsey, Jersey, Man Adası) bilinçli olarak yok.
export const PARENT_COUNTRY = {
  GL: 'DK',
  FO: 'DK',
  PR: 'US',
  GU: 'US',
  VI: 'US',
  AS: 'US',
  NC: 'FR',
  PF: 'FR',
  GF: 'FR',
  GP: 'FR',
  MQ: 'FR',
  RE: 'FR',
  YT: 'FR',
  BM: 'GB',
  TC: 'GB',
  KY: 'GB',
  VG: 'GB',
  FK: 'GB',
  AW: 'NL',
  CW: 'NL',
}

const pressStmt = db.prepare(`
  SELECT COUNT(*) scanned, COUNT(DISTINCT series_id) series,
    SUM(total_news_count > 0) withNews, SUM(COALESCE(total_news_count, 0)) news,
    AVG(CASE WHEN positive_score IS NOT NULL THEN positive_score END) pos,
    AVG(CASE WHEN negative_score IS NOT NULL THEN negative_score END) neg,
    SUM(positive_score IS NOT NULL) analyzed
  FROM media_sentiment WHERE country_iso2 = ? AND source IN ('google_news', 'gdelt')
`)

function pressSummary(iso2) {
  const r = pressStmt.get(iso2)
  if (!r?.scanned) return null
  const tone = r.analyzed > 0 ? (r.pos - r.neg > 0.15 ? 'olumlu' : r.neg - r.pos > 0.15 ? 'olumsuz' : 'nötr') : null
  return {
    scanned: r.scanned,
    series: r.series,
    withNews: r.withNews || 0,
    news: r.news || 0,
    tone,
    positivePct: r.analyzed > 0 ? Math.round(r.pos * 100) : null,
  }
}

export async function getCountryContext(iso2, { rankings = null } = {}) {
  const code = String(iso2).toUpperCase()
  const parentIso2 = PARENT_COUNTRY[code] ?? null
  let parent = null
  if (parentIso2) {
    const own = (rankings ?? (await getAllOwnRankings())).get(parentIso2)
    parent = {
      iso2: parentIso2,
      week: own?.to ?? null,
      now: (own?.current || [])
        .slice(0, 5)
        .map((it) => ({ seriesId: it.seriesId ?? null, name: it.name, position: it.position })),
    }
  }
  return { iso2: code, students: getForeignStudentSummary(code), press: pressSummary(code), parent }
}
