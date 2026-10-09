import { IconBack, IconClose } from './Icons.jsx'

/**
 * Haritada etkin filtre kartı (2026-10-07; önceki ince şerit gözden kaçıyordu): ne gösterildiği, açıklaması,
 * filtreyi açan dizi raporuna dönüş (birincil düğme) ve filtreyi kaldırma.
 */
export default function MapFilterCard({
  kicker,
  title,
  description,
  onReturn,
  returnLabel = 'Dizi raporuna dön',
  onClear,
}) {
  return (
    <div className="map-filter" role="status" aria-live="polite">
      <div className="map-filter__text">
        <span className="map-filter__kicker">{kicker}</span>
        <strong className="map-filter__title">{title}</strong>
        {description && <span className="map-filter__desc">{description}</span>}
      </div>
      <div className="map-filter__actions">
        {onReturn && (
          <button type="button" className="map-filter__btn map-filter__btn--primary" onClick={onReturn}>
            <IconBack />
            {returnLabel}
          </button>
        )}
        <button type="button" className="map-filter__btn" onClick={onClear}>
          <IconClose size={13} inline />
          Filtreyi kaldır
        </button>
      </div>
    </div>
  )
}
