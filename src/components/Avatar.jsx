import { useState } from 'react'

/** "Orhan Becerir" → "OB"; tek kelimede ilk harf. */
export function initialsOf(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return ''
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return `${first}${last}`.toLocaleUpperCase('tr')
}

/**
 * Oyuncu fotoğrafı. TMDB'de fotoğrafı olmayan (ya da yüklenemeyen) kişilerde boş koyu daire yerine baş
 * harfler gösterilir — TMDB ve Wikidata'da görseli bulunmayan yan rol oyuncuları için güvenilir başka kaynak yok.
 * Boyut, verilen `className`den gelir (cast-bar__photo, actor-modal__photo…).
 */
export default function Avatar({ src, name, className }) {
  const [failedSrc, setFailedSrc] = useState(null)
  if (src && failedSrc !== src) {
    return <img className={className} src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} />
  }
  return (
    <span className={`${className} avatar--initials`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}
