// IMDb bölüm puanları: her satır bir sezon, her kare bir bölüm (renk = puan). Puanı olmayan bölüm gri.
// Az oylu bölümler dalgalanabilir — oy sayısı kare ipucunda yazar; en iyi/en zayıf seçiminde az oylu bölümler
// sayılmaz (2026-10-07: tek cümlelik özet yerine kartlar, gidişat ve karede işaret).

const RATING_STEPS = [
  [9, '#1a9850'],
  [8, '#66bd63'],
  [7, '#a6d96a'],
  [6, '#fee08b'],
  [5, '#fdae61'],
  [0, '#f46d43'],
]
const LEGEND = ['<5', '5', '6', '7', '8', '9+']
const MIN_RATED = 3
// En iyi/en zayıf bölüm için en az oy: medyan oyun dörtte biri (en az 5) — birkaç oylu bölüm uç değer üretir.
const MIN_VOTE_SHARE = 0.25
// Sezonlar arası fark bu kadar puandan azsa "sabit" sayılır.
const FLAT_DELTA = 0.2

export function ratingColor(rating) {
  if (rating == null) return null
  return RATING_STEPS.find(([min]) => rating >= min)[1]
}

function average(episodes) {
  const rated = episodes.filter((e) => e.rating != null)
  return rated.length ? rated.reduce((sum, e) => sum + e.rating, 0) / rated.length : null
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

const epLabel = (e) => `${e.season}. sezon ${e.episode}. bölüm`
const fmtVotes = (n) => new Intl.NumberFormat('tr-TR').format(n ?? 0)

/** Özet: ortalama, en iyi/en zayıf (yeterli oylu bölümler arasından) ve gidişat. */
export function episodeSummary(seasons = []) {
  const all = seasons.flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.season })))
  const rated = all.filter((e) => e.rating != null)
  if (rated.length < MIN_RATED) return null
  const minVotes = Math.max(5, Math.round(median(rated.map((e) => e.votes ?? 0)) * MIN_VOTE_SHARE))
  const pool = rated.filter((e) => (e.votes ?? 0) >= minVotes)
  const candidates = pool.length >= MIN_RATED ? pool : rated
  const best = candidates.reduce((a, b) => (b.rating > a.rating ? b : a))
  const worst = candidates.reduce((a, b) => (b.rating < a.rating ? b : a))

  let trend = null
  const seasonAvgs = seasons.map((s) => ({ season: s.season, avg: average(s.episodes) })).filter((s) => s.avg != null)
  if (seasonAvgs.length >= 2) {
    const first = seasonAvgs[0]
    const last = seasonAvgs.at(-1)
    trend = { from: first.avg, to: last.avg, fromLabel: `${first.season}. sezon`, toLabel: `${last.season}. sezon` }
  } else {
    // Tek sezon: ilk yarı ile ikinci yarı.
    const eps = seasons[0]?.episodes.filter((e) => e.rating != null) || []
    if (eps.length >= 6) {
      const half = Math.floor(eps.length / 2)
      trend = {
        from: average(eps.slice(0, half)),
        to: average(eps.slice(half)),
        fromLabel: 'ilk yarı',
        toLabel: 'ikinci yarı',
      }
    }
  }
  if (trend) {
    const d = trend.to - trend.from
    trend.direction = Math.abs(d) < FLAT_DELTA ? 'sabit' : d > 0 ? 'yükseldi' : 'düştü'
  }
  return { ratedCount: rated.length, total: all.length, avg: average(rated), best, worst, minVotes, trend }
}

export default function EpisodeHeatmap({ seasons = [] }) {
  const sum = episodeSummary(seasons)
  if (!sum) return null
  const { best, worst, trend } = sum
  const isBest = (s, e) => s === best.season && e === best.episode
  const isWorst = (s, e) => s === worst.season && e === worst.episode

  return (
    <div className="episode-map">
      <dl className="episode-map__cards">
        <div className="episode-map__card">
          <dt>Ortalama</dt>
          <dd className="episode-map__card-value">{sum.avg.toFixed(1)}</dd>
          <dd className="episode-map__card-detail">
            {sum.ratedCount}/{sum.total} bölüm puanlı
          </dd>
        </div>
        <div className="episode-map__card episode-map__card--best">
          <dt>En iyi bölüm</dt>
          <dd className="episode-map__card-value">{best.rating.toFixed(1)}</dd>
          <dd className="episode-map__card-detail">
            {epLabel(best)} · {fmtVotes(best.votes)} oy
          </dd>
        </div>
        <div className="episode-map__card episode-map__card--worst">
          <dt>En zayıf bölüm</dt>
          <dd className="episode-map__card-value">{worst.rating.toFixed(1)}</dd>
          <dd className="episode-map__card-detail">
            {epLabel(worst)} · {fmtVotes(worst.votes)} oy
          </dd>
        </div>
        {trend && (
          <div className="episode-map__card">
            <dt>Gidişat</dt>
            <dd className="episode-map__card-value">
              {trend.direction === 'yükseldi' ? '▲' : trend.direction === 'düştü' ? '▼' : '■'} {trend.direction}
            </dd>
            <dd className="episode-map__card-detail">
              {trend.fromLabel} {trend.from.toFixed(1)} → {trend.toLabel} {trend.to.toFixed(1)}
            </dd>
          </div>
        )}
      </dl>
      <p className="episode-map__note">
        En iyi ve en zayıf bölüm, en az {sum.minVotes} oy almış bölümler arasından seçilir; karelerde çerçeveyle
        işaretlidir. Kareye gelince bölümün puanı ve oy sayısı görünür.
      </p>
      {seasons.map((s) => {
        const avg = average(s.episodes)
        return (
          <div key={s.season} className="episode-map__row">
            <span className="episode-map__label">{s.season}. sezon</span>
            <div className="episode-map__cells">
              {s.episodes.map((e) => (
                <span
                  key={e.episode}
                  className={`episode-map__cell${isBest(s.season, e.episode) ? ' episode-map__cell--best' : ''}${
                    isWorst(s.season, e.episode) ? ' episode-map__cell--worst' : ''
                  }`}
                  style={e.rating != null ? { background: ratingColor(e.rating) } : undefined}
                  title={
                    e.rating != null
                      ? `${s.season}. sezon ${e.episode}. bölüm: ${e.rating.toFixed(1)} (${e.votes} oy)`
                      : `${s.season}. sezon ${e.episode}. bölüm: puan yok`
                  }
                />
              ))}
            </div>
            <span className="episode-map__avg">{avg != null ? avg.toFixed(1) : '—'}</span>
          </div>
        )
      })}
      <div className="episode-map__legend" aria-hidden="true">
        {[...RATING_STEPS].reverse().map(([, color], i) => (
          <span key={color} className="episode-map__legend-item">
            <span className="episode-map__cell" style={{ background: color }} />
            {LEGEND[i]}
          </span>
        ))}
        <span className="episode-map__legend-item">
          <span className="episode-map__cell" />
          puan yok
        </span>
      </div>
    </div>
  )
}
