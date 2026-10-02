import { useEffect, useRef, useState } from 'react'
import { fetchMagazinePreview } from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import { safeExternalUrl } from '../lib/safeUrl.js'
import { fmtDateTr } from './ChartList.jsx'

// Dizi ve başrol oyuncuları hakkında güncel magazin haberleri (dizilah düzeni): solda büyük haber — görsel
// üzerinde tarih, başlık ve özet; sağda küçük görselli haber listesi. Haberler sırayla geçer; etkin haber
// listede vurgulanır ve arka planı süre boyunca dolar. Listeden seçim yalnızca soldaki haberi değiştirir —
// haber açılmaz, haber sitesine gidilmez (kullanıcı talebi). Fare üzerindeyken / odaktayken ve "hareketi
// azalt" tercihinde kendiliğinden geçmez. Özet sitenin kendi paylaşım özetidir; kaynak adı yazılmaz.
// Bkz. server/services/magazineNews.js — izinli kaynaklar, süzgeçler, özet.

export const SLIDE_MS = 7000

/**
 * Görsel; yüklenemezse sıradaki adayı dener, hiçbiri yüklenmezse boş kutu (kırık resim simgesi yok).
 * Örn. bazı kurum ağlarında Demirören görsel sunucusu (static.domer.tr) güvenlik filtresine takılıyor.
 * Aday listesi değişince yeniden denensin diye çağıran `key` verir.
 */
function Thumb({ srcs, className }) {
  const candidates = [...new Set((srcs || []).map(safeExternalUrl).filter(Boolean))]
  const [failed, setFailed] = useState(0)
  const url = candidates[failed]
  return url ? (
    <img className={className} src={url} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} />
  ) : (
    <span className={`${className} ${className}--empty`} aria-hidden="true" />
  )
}

/** Gösterilebilir haberler: güvenli bağlantısı olanlar, en çok `limit`. */
export function visibleMagazineItems(items, limit = 10) {
  return (items || []).filter((it) => safeExternalUrl(it.link)).slice(0, limit)
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function MagazineCarousel({ items, intervalMs = SLIDE_MS }) {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const listRef = useRef(null)
  const count = items?.length || 0
  const index = count ? Math.min(active, count - 1) : 0
  const item = count ? items[index] : null
  // Etkin haberin büyük görseli ve özeti (önbellekli; yalnızca görünen haber için istenir).
  const { status, data } = useAsync(() => fetchMagazinePreview(item.link), [item?.link], { enabled: Boolean(item) })
  const auto = count > 1 && !paused && !prefersReducedMotion()

  useEffect(() => {
    if (!auto) return undefined
    const t = setTimeout(() => setActive((i) => (i + 1) % count), intervalMs)
    return () => clearTimeout(t)
  }, [auto, active, count, intervalMs])

  // Etkin haber listede görünür kalsın — yalnızca liste kaydırılır, sayfa kaydırılmaz.
  useEffect(() => {
    const list = listRef.current
    const el = list?.children[index]
    if (!list || !el) return
    if (el.offsetTop < list.scrollTop || el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2
    }
  }, [index])

  if (!item) return <p className="dashboard__empty">Bu dizi ve oyuncuları hakkında güncel haber bulunamadı.</p>

  const date = data?.publishedAt || item.date

  return (
    <div
      className="magazine-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Magazin haberleri"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="magazine-carousel__hero" aria-roledescription="slide" aria-label={`${index + 1} / ${count}`}>
        <Thumb
          key={`${item.link}|${data?.image ?? ''}`}
          srcs={[data?.image, item.thumbnail]}
          className="magazine-carousel__image"
        />
        <div className="magazine-carousel__overlay">
          {date && <span className="magazine-carousel__date">{fmtDateTr(date)}</span>}
          <h3 className="magazine-carousel__title">{item.title}</h3>
          {status === 'loading' || status === 'idle' ? (
            <p className="magazine-carousel__summary magazine-carousel__summary--muted">Özet yükleniyor…</p>
          ) : data?.summary ? (
            <p className="magazine-carousel__summary">{data.summary}</p>
          ) : null}
        </div>
      </div>

      {count > 1 && (
        <div className="magazine-carousel__aside">
          <ol className="magazine-carousel__list" ref={listRef}>
            {items.map((it, i) => (
              <li key={it.link}>
                <button
                  type="button"
                  className={
                    i === index ? 'magazine-carousel__item magazine-carousel__item--active' : 'magazine-carousel__item'
                  }
                  onClick={() => setActive(i)}
                  aria-current={i === index ? 'true' : undefined}
                >
                  {i === index && (
                    <span
                      key={`dolum-${active}`}
                      className={`magazine-carousel__fill${auto ? '' : ' magazine-carousel__fill--paused'}`}
                      style={{ animationDuration: `${intervalMs}ms` }}
                      aria-hidden="true"
                    />
                  )}
                  <Thumb srcs={[it.thumbnail]} className="magazine-carousel__thumb" />
                  <span className="magazine-carousel__item-title">{it.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
