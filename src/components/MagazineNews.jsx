import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMagazineNews, fetchMagazinePreview } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import { useDialog } from '../lib/useDialog.js'
import { safeExternalUrl } from '../lib/safeUrl.js'
import { fmtDateTr } from './ChartList.jsx'

// Dizi ve başrol oyuncuları hakkında güncel magazin haberleri: görsel + başlık + tarih kartları.
// Kart haber sitesine gitmez; platform içinde büyük bir okuma penceresi açılır, haberler alt alta
// kaydırılarak okunur (görsel, başlık, tarih, sitenin kendi paylaşım özeti). Kaynak adı gösterilmez
// (kullanıcı talebi). Bkz. server/services/magazineNews.js — izinli kaynaklar, süzgeçler, özet.

function Thumb({ src, className }) {
  const url = safeExternalUrl(src)
  return url ? (
    <img className={className} src={url} alt="" loading="lazy" />
  ) : (
    <span className={`${className} ${className}--empty`} aria-hidden="true" />
  )
}

function ReaderEntry({ item, entryRef }) {
  const { status, data } = useAsync(() => fetchMagazinePreview(item.link), [item.link])
  const date = data?.publishedAt || item.date
  return (
    <article className="magazine-reader__entry" ref={entryRef}>
      <Thumb src={data?.image || item.thumbnail} className="magazine-reader__image" />
      <h3 className="magazine-reader__title">{item.title}</h3>
      {date && <p className="magazine-reader__date">{fmtDateTr(date)}</p>}
      {status === 'loading' || status === 'idle' ? (
        <p className="magazine-reader__summary magazine-reader__summary--muted">Özet yükleniyor…</p>
      ) : data?.summary ? (
        <p className="magazine-reader__summary">{data.summary}</p>
      ) : (
        <p className="magazine-reader__summary magazine-reader__summary--muted">Bu haber için özet bulunamadı.</p>
      )}
    </article>
  )
}

/** Büyük okuma penceresi: tüm haberler alt alta; açılışta tıklanan habere kaydırılır. */
export function MagazineReader({ items, startIndex = 0, onClose }) {
  const boxRef = useRef(null)
  const feedRef = useRef(null)
  const entryRefs = useRef([])
  useDialog(boxRef, onClose)

  // Tıklanan habere anında kaydır. Yumuşak kaydırma, useDialog'un açılıştaki odaklaması tarafından yarıda
  // kesiliyordu; bir kare sonra ve doğrudan scrollTop ile yapılır (görsellerin yüksekliği aspect-ratio ile
  // yüklenmeden bellidir, konum kaymaz).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const feed = feedRef.current
      const entry = entryRefs.current[startIndex]
      if (!feed || !entry) return
      feed.scrollTop = entry.getBoundingClientRect().top - feed.getBoundingClientRect().top + feed.scrollTop
    })
    return () => cancelAnimationFrame(id)
  }, [startIndex])

  return (
    <div className="modal-overlay magazine-reader__overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="magazine-reader"
        role="dialog"
        aria-modal="true"
        aria-labelledby="magazine-reader-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="magazine-reader__bar">
          <h2 id="magazine-reader-heading" className="magazine-reader__heading">
            Magazin
          </h2>
          <button type="button" className="magazine-reader__close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </div>
        <div className="magazine-reader__feed" ref={feedRef}>
          {items.map((it, i) => (
            <ReaderEntry
              key={it.link}
              item={it}
              entryRef={(el) => {
                entryRefs.current[i] = el
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function MagazineList({ items, limit = 5 }) {
  const [openIndex, setOpenIndex] = useState(null)
  // Sabit kimlik: useDialog her yeni onClose'ta odağı yeniden kurar.
  const close = useCallback(() => setOpenIndex(null), [])
  const shown = (items || []).filter((it) => safeExternalUrl(it.link)).slice(0, limit)
  if (!shown.length) return <p className="dashboard__empty">Bu dizi ve oyuncuları hakkında güncel haber bulunamadı.</p>
  return (
    <>
      <ul className="magazine-list">
        {shown.map((it, i) => (
          <li key={it.link} className="magazine-list__item">
            <button type="button" className="magazine-list__link" onClick={() => setOpenIndex(i)}>
              <Thumb src={it.thumbnail} className="magazine-list__thumb" />
              <span className="magazine-list__title">{it.title}</span>
              {it.date && <span className="magazine-list__date">{fmtDateTr(it.date)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {openIndex != null && <MagazineReader items={shown} startIndex={openIndex} onClose={close} />}
    </>
  )
}

export default function MagazineNews({ seriesId, limit = 5 }) {
  const { status, data } = useAsync(() => fetchMagazineNews(seriesId), [seriesId], { enabled: seriesId != null })
  if (status === 'loading' || status === 'idle') return <p className="dashboard__empty">Haberler yükleniyor…</p>
  if (status === 'error' || !data) return <p className="dashboard__empty">Haberler şu an alınamadı.</p>
  return <MagazineList items={data.items} limit={limit} />
}
