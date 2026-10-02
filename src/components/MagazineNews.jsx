import { fetchMagazineNews } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import { safeExternalUrl } from '../lib/safeUrl.js'

// Dizi ve başrol oyuncuları hakkında güncel magazin haberleri: görsel + başlık kartları (kullanıcı talebi:
// kaynak adı ve tarih gösterilmez). Kart haberin kendi sitesine gider; başlık değiştirilmez
// (bkz. server/services/magazineNews.js — izinli kaynaklar, süzgeçler).

export function MagazineList({ items, limit = 5 }) {
  const shown = (items || []).filter((it) => safeExternalUrl(it.link)).slice(0, limit)
  if (!shown.length) return <p className="dashboard__empty">Bu dizi ve oyuncuları hakkında güncel haber bulunamadı.</p>
  return (
    <ul className="magazine-list">
      {shown.map((it) => (
        <li key={it.link} className="magazine-list__item">
          <a className="magazine-list__link" href={safeExternalUrl(it.link)} target="_blank" rel="noopener noreferrer">
            {safeExternalUrl(it.thumbnail) ? (
              <img className="magazine-list__thumb" src={safeExternalUrl(it.thumbnail)} alt="" loading="lazy" />
            ) : (
              <span className="magazine-list__thumb magazine-list__thumb--empty" aria-hidden="true" />
            )}
            <span className="magazine-list__title">{it.title}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export default function MagazineNews({ seriesId, limit = 5 }) {
  const { status, data } = useAsync(() => fetchMagazineNews(seriesId), [seriesId], { enabled: seriesId != null })
  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Haberler yükleniyor…</p>
  if (status === 'error' || !data) return <p className="dashboard__empty">Haberler şu an alınamadı.</p>
  return <MagazineList items={data.items} limit={limit} />
}
