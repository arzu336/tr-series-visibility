import { useEffect, useRef } from 'react'
import Avatar from './Avatar.jsx'

const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'

/**
 * `scroll`: dizi sayfasındaki uzun kadro şeridi — hayalet kaydırma çubuğu; fare tekerleği şeridi yatay
 * kaydırır (şeridin ucuna gelince tekerlek yine sayfayı kaydırır).
 */
export default function CastBar({ cast, onSelectActor, scroll = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!scroll || !el) return undefined
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const atEdge = (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)
      if (atEdge) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scroll, cast])

  if (!cast || cast.length === 0) {
    return (
      <p className="dashboard__empty" style={{ margin: '0.5rem 0 0' }}>
        Oyuncu kadrosu bulunamadı.
      </p>
    )
  }
  return (
    <div ref={ref} className={scroll ? 'cast-bar cast-bar--scroll' : 'cast-bar'}>
      {cast.map((actor) => (
        <button key={actor.id} className="cast-bar__item" onClick={() => onSelectActor?.(actor.id)}>
          <Avatar
            className="cast-bar__photo"
            src={actor.profilePath ? `${PROFILE_BASE}${actor.profilePath}` : null}
            name={actor.name}
          />
          <span className="cast-bar__name">{actor.name}</span>
          {actor.character && <span className="cast-bar__character">{actor.character}</span>}
        </button>
      ))}
    </div>
  )
}
