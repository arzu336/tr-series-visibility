import { fetchMagazineNews } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import { safeExternalUrl } from '../lib/safeUrl.js'
import { fmtDateTr } from './ChartList.jsx'

// Dizi ve başrol oyuncuları hakkında güncel magazin haberleri. Haber değiştirilmeden gösterilir:
// başlık, yayın kuruluşu, tarih ve haberin kendi sitesine bağlantı (bkz. server/services/magazineNews.js).

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
            <span className="magazine-list__body">
              <span className="magazine-list__title">{it.title}</span>
              <span className="magazine-list__meta">
                {it.source}
                {it.date ? ` · ${fmtDateTr(it.date)}` : ''}
                {it.about && it.about !== 'dizi' ? ` · ${it.about}` : ''}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export default function MagazineNews({ seriesId }) {
  const { status, data } = useAsync(() => fetchMagazineNews(seriesId), [seriesId], { enabled: seriesId != null })
  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Haberler yükleniyor…</p>
  if (status === 'error' || !data) return <p className="dashboard__empty">Haberler şu an alınamadı.</p>
  return <MagazineList items={data.items} />
}
