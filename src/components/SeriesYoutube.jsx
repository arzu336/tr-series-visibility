import { fetchSeriesYoutube } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'

// Dizi sayfası → YouTube: resmî yayıncı kanallarındaki bölüm videolarının herkese açık sayıları ve yorumların
// dil dağılımı. Ülke kırılımı değildir (o yalnızca kanal sahibinin izniyle gelir); veri yoksa bölüm görünmez.

const fmt = (n) => new Intl.NumberFormat('tr-TR', { notation: n >= 1e6 ? 'compact' : 'standard' }).format(n)
const langName = (code) => {
  try {
    const n = new Intl.DisplayNames(['tr'], { type: 'language' }).of(code === 'sh' ? 'sr-Latn' : code)
    return n ? n.charAt(0).toLocaleUpperCase('tr') + n.slice(1) : code
  } catch {
    return code
  }
}
const day = (iso) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })

export default function SeriesYoutube({ seriesId }) {
  const { status, data } = useAsync(() => fetchSeriesYoutube(seriesId), [seriesId])
  if (status !== 'ready' || !data?.totals) return null
  const { totals, growth30, comments } = data
  const top = comments?.langs.slice(0, 6) ?? []
  const max = Math.max(...top.map((l) => l.share), 0.01)
  return (
    <section className="series-page__section">
      <h2>YouTube</h2>
      <p className="series-page__sentiment-line">
        Resmî kanallarda {totals.videos} video · {fmt(totals.views)} izlenme · {fmt(totals.likes)} beğeni
      </p>
      {growth30 && growth30.views > 0 && (
        <p className="series-page__sentiment-line">
          <span className="series-page__pill--up">+{fmt(growth30.views)} izlenme</span> ({day(growth30.since)}'den bu
          yana)
        </p>
      )}
      {top.length > 0 && (
        <>
          <h3 className="series-interest__title">Yorumların dili</h3>
          <div className="benchmark-card__bars" role="list" aria-label="Yorumların dil dağılımı">
            {top.map((l) => (
              <div key={l.lang} className="benchmark-card__row" role="listitem">
                <div className="benchmark-card__row-label">{langName(l.lang)}</div>
                <div className="benchmark-card__row-bar-track">
                  <div className="benchmark-card__row-bar" style={{ width: `${(l.share / max) * 100}%` }} />
                </div>
                <div className="benchmark-card__row-value">%{Math.round(l.share * 100)}</div>
              </div>
            ))}
          </div>
          <p className="dashboard__hint">
            Son bölümlerden {comments.sampled} yorum örneklendi ({day(comments.sampledAt)}). Dil ülke değildir: yorumun
            hangi bölgeden yazıldığına dair kaba bir işarettir.
          </p>
        </>
      )}
    </section>
  )
}
