const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185'

// Dizi detayında (CountryPanel'in genişletilmiş satırı) yatay kaydırılabilir oyuncu kartı
// listesi — TMDB credits'ten gelen gerçek profil fotoğrafı/isim/karakter adı. Bir karta
// tıklamak server/cast.js'teki oyuncu-etki sorgusunu (ActorModal.jsx) açar.
export default function CastBar({ cast, onSelectActor }) {
  if (!cast || cast.length === 0) {
    return <p className="dashboard__empty" style={{ margin: '0.5rem 0 0' }}>Oyuncu kadrosu bulunamadı.</p>
  }
  return (
    <div className="cast-bar">
      {cast.map((actor) => (
        <button key={actor.id} className="cast-bar__item" onClick={() => onSelectActor?.(actor.id)}>
          {actor.profilePath ? (
            <img className="cast-bar__photo" src={`${PROFILE_BASE}${actor.profilePath}`} alt="" />
          ) : (
            <span className="cast-bar__photo cast-bar__photo--empty" aria-hidden="true" />
          )}
          <span className="cast-bar__name">{actor.name}</span>
          {actor.character && <span className="cast-bar__character">{actor.character}</span>}
        </button>
      ))}
    </div>
  )
}
