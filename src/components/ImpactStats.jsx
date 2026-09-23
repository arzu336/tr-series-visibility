import { useEffect, useState } from 'react'
import {
  MARKET_SHARE_NOTE,
  MEDIA_TONE_NOTE,
  DESTINATION_SHARE_NOTE,
} from '../lib/methodologyNotes.js'
import { fetchCulturalImpact, fetchTourismImpact, fetchExportImpact, fetchBenchmark } from '../lib/api.js'

function round1(n) {
  return Math.round(n * 10) / 10
}

export default function ImpactStats() {
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    Promise.all([fetchCulturalImpact(), fetchTourismImpact(), fetchExportImpact(), fetchBenchmark().catch(() => null)])
      .then(([cultural, tourism, exportData, benchmark]) => {
        const topDestination = tourism.topDestinations[0]
        const totalDestScore = tourism.topDestinations.reduce((sum, d) => sum + d.totalScore, 0) + tourism.otherDestinationsScore
        const tr = benchmark?.countries?.find((c) => c.code === 'TR')

        setStats({
          totalCountries: exportData.totalCountries,
          marketSharePct: tr?.marketSharePct ?? null,
          mediaTonePct:
            cultural.mediaSentimentSummary.status === 'ready'
              ? Math.round(cultural.mediaSentimentSummary.avgPositive * 100)
              : null,
          topDestinationSharePct:
            topDestination && totalDestScore > 0 ? round1((topDestination.totalScore / totalDestScore) * 100) : null,
          topDestinationName: topDestination?.name ?? null,
        })
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  if (status !== 'ready' || !stats) return null

  return (
    <div className="impact-stats">
      <div className="impact-stats__card">
        <div className="impact-stats__num">{stats.totalCountries}</div>
        <div className="impact-stats__label" title="TMDB/JustWatch sağlayıcı verisinde en az bir Türk dizisi görünen ülke sayısı.">
          Takip Edilen Ülke ⓘ
        </div>
      </div>
      <div className="impact-stats__card">
        <div className="impact-stats__num">{stats.marketSharePct != null ? `%${stats.marketSharePct}` : '—'}</div>
        <div className="impact-stats__label" title={MARKET_SHARE_NOTE}>
          TR Küresel Pazar Payı ⓘ
        </div>
      </div>
      <div className="impact-stats__card">
        <div className="impact-stats__num">{stats.mediaTonePct != null ? `%${stats.mediaTonePct}` : '—'}</div>
        <div className="impact-stats__label" title={MEDIA_TONE_NOTE}>
          Olumlu Medya Tonu ⓘ
        </div>
      </div>
      <div className="impact-stats__card">
        <div className="impact-stats__num">
          {stats.topDestinationSharePct != null ? `%${stats.topDestinationSharePct}` : '—'}
        </div>
        <div className="impact-stats__label" title={DESTINATION_SHARE_NOTE}>
          {stats.topDestinationName || 'Öncü Destinasyon'} Destinasyon Payı ⓘ
        </div>
      </div>
    </div>
  )
}
