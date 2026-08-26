import { useEffect, useState } from 'react'
import { fetchMediaSentiment, fetchRegionalInterest } from '../lib/api.js'

const SENTIMENT_LABELS = {
  positive: 'Olumlu Basın Algısı',
  neutral: 'Nötr Basın Algısı',
  negative: 'Olumsuz Basın Algısı',
}

function timeAgo(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'bugün tarandı'
  if (days === 1) return 'dün tarandı'
  return `${days} gün önce tarandı`
}

// Proje raporu §4.6 "Basın/Haber Duygu Analizi" — GET /api/media-sentiment/:seriesId/:iso2.
// Bu uç nokta cache-first çalışır (bkz. server/services/newsSentiment.js): eğer o dizi/ülke
// için önceden taranmış geçerli bir kayıt varsa SerpAPI/LLM'e HİÇ gitmeden anında döner, yoksa
// gerçek bir tarama başlatır. Panel satırını genişletmek zaten bilinçli bir kullanıcı eylemi
// olduğu için (RegionalInterest/CastBar'la aynı "on-demand" desen) otomatik yüklenir; hata/veri
// yok durumunda "Şimdi Tara" bir YENİDEN DENEME olarak sunulur, kart asla çökmez.
export default function MediaSentimentCard({ seriesId, iso2, seriesName }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const load = () => {
    if (!seriesId || !iso2) return
    setState({ status: 'loading', data: null, error: null })
    fetchMediaSentiment(seriesId, iso2)
      .then((data) => {
        const hasSignal = data.totalNewsCount > 0 && data.dominantSentiment !== 'yetersiz-veri'
        setState({ status: hasSignal ? 'ready' : 'empty', data, error: null })
      })
      .catch((err) => {
        setState({ status: 'error', data: null, error: err.message })
      })
  }

  useEffect(load, [seriesId, iso2])

  if (state.status === 'loading') {
    return (
      <div className="media-sentiment media-sentiment--skeleton" aria-busy="true" aria-label="Basın algısı yükleniyor">
        <div className="media-sentiment__skel-bar" />
        <div className="media-sentiment__skel-line" />
        <div className="media-sentiment__skel-line media-sentiment__skel-line--short" />
      </div>
    )
  }

  if (state.status === 'error' || state.status === 'empty') {
    return (
      <div className="media-sentiment media-sentiment--empty">
        <p className="dashboard__empty">
          {state.status === 'error'
            ? `Basın taraması başarısız oldu (${state.error}).`
            : 'Bu ülke için basın taraması henüz yeterli haber bulamadı.'}
        </p>
        <button type="button" className="media-sentiment__scan-btn" onClick={load}>
          Şimdi Tara
        </button>
      </div>
    )
  }

  const { data } = state
  const dominant = data.dominantSentiment
  const total = (data.positiveScore ?? 0) + (data.neutralScore ?? 0) + (data.negativeScore ?? 0) || 1
  const pct = {
    positive: Math.round(((data.positiveScore ?? 0) / total) * 100),
    neutral: Math.round(((data.neutralScore ?? 0) / total) * 100),
    negative: Math.round(((data.negativeScore ?? 0) / total) * 100),
  }

  return (
    <div className="media-sentiment">
      <div className="media-sentiment__header">
        <span className={`media-sentiment__badge media-sentiment__badge--${dominant}`}>
          {SENTIMENT_LABELS[dominant] || 'Basın Algısı'}
        </span>
        <span className="media-sentiment__meta">
          {data.totalNewsCount} haber · {timeAgo(data.createdAt)}
          {data.stale && <span title="Şu an erişilemiyor, önceki tarama gösteriliyor"> · güncel değil</span>}
        </span>
      </div>

      <div className="media-sentiment__bar" role="img" aria-label={`Pozitif %${pct.positive}, nötr %${pct.neutral}, negatif %${pct.negative}`}>
        {pct.positive > 0 && (
          <div className="media-sentiment__bar-seg media-sentiment__bar-seg--positive" style={{ width: `${pct.positive}%` }} />
        )}
        {pct.neutral > 0 && (
          <div className="media-sentiment__bar-seg media-sentiment__bar-seg--neutral" style={{ width: `${pct.neutral}%` }} />
        )}
        {pct.negative > 0 && (
          <div className="media-sentiment__bar-seg media-sentiment__bar-seg--negative" style={{ width: `${pct.negative}%` }} />
        )}
      </div>
      <div className="media-sentiment__bar-legend">
        <span><i className="media-sentiment__dot media-sentiment__dot--positive" />Olumlu %{pct.positive}</span>
        <span><i className="media-sentiment__dot media-sentiment__dot--neutral" />Nötr %{pct.neutral}</span>
        <span><i className="media-sentiment__dot media-sentiment__dot--negative" />Olumsuz %{pct.negative}</span>
      </div>

      {data.llmSummary && (
        <blockquote className="media-sentiment__summary">
          {data.llmSummary}
          <cite>Yapay Zeka</cite>
        </blockquote>
      )}
    </div>
  )
}

// TMDB'nin tek küresel popülerlik sayısını (bkz. server/series-period-history.js'teki aynı
// prensip) bu ülkedeki Google Trends arama ilgisiyle ağırlıklandıran ÇARPAN — gerçek bir
// "izleyici sayısı" değil, dürüstçe etiketlenen bir türev skor (bkz.
// server/services/serpApiCache.js calculateRegionalScore). Yerel ilgi hiç yoksa/veri
// eksikse gizlemek yerine bunu açıkça söyler.
export function HybridScoreTag({ seriesName, iso2 }) {
  const [state, setState] = useState({ status: 'loading', hybrid: null })

  useEffect(() => {
    if (!seriesName || !iso2) return
    let cancelled = false
    setState({ status: 'loading', hybrid: null })
    fetchRegionalInterest(seriesName, iso2)
      .then((res) => {
        if (cancelled) return
        setState({ status: res.hybridScore ? 'ready' : 'unavailable', hybrid: res.hybridScore })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable', hybrid: null })
      })
    return () => {
      cancelled = true
    }
  }, [seriesName, iso2])

  if (state.status === 'loading') return <span className="hybrid-score hybrid-score--loading">Yerel skor hesaplanıyor…</span>
  if (state.status === 'unavailable' || !state.hybrid) return null

  const { score, multiplier, localInterest, basis } = state.hybrid
  const isLow = basis === 'yetersiz-veri' || (localInterest ?? 0) < 5

  return (
    <div className={isLow ? 'hybrid-score hybrid-score--low' : 'hybrid-score'}>
      <span className="hybrid-score__row">
        <span className="hybrid-score__label">Yerel İlgi Çarpanı</span>
        <span className="hybrid-score__value">{multiplier}x</span>
      </span>
      <span className="hybrid-score__row">
        <span className="hybrid-score__label">Nihai Yerel Görünürlük Skoru</span>
        <span className="hybrid-score__value hybrid-score__value--final">{score.toFixed(1)}</span>
      </span>
      {isLow && (
        <span className="hybrid-score__note">
          {basis === 'yetersiz-veri'
            ? 'Bu ülke için arama ilgisi verisi döndürmedi — çarpan nötr (1x) uygulandı.'
            : `Yerel Arama İlgisi Düşük / Çarpan: ${multiplier}x`}
        </span>
      )}
    </div>
  )
}
