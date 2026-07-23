// Klasik nokta+etiket legend yerine: sıra numarası, renk göstergesi, isim,
// yüzde ve (varsa) trend okunu bir arada gösteren kart satırları. DonutChart
// ile aynı hoveredId state'ini paylaşır — birine dokunmak diğerini de vurgular.
export default function DonutRankedList({ items, hoveredId, onHoverChange, onSelect }) {
  const clickable = Boolean(onSelect)

  return (
    <ul className="donut-list">
      {items.map((item, idx) => {
        const isHovered = hoveredId === item.id
        const rowClickable = clickable && !item.isOther
        return (
          <li
            key={item.id}
            className={`donut-list__row${isHovered ? ' donut-list__row--hovered' : ''}${
              item.isOther ? ' donut-list__row--other' : ''
            }${rowClickable ? ' donut-list__row--clickable' : ''}`}
            onMouseEnter={() => onHoverChange?.(item.id)}
            onMouseLeave={() => onHoverChange?.(null)}
            onClick={() => rowClickable && onSelect(item)}
          >
            <span className="donut-list__rank">{idx + 1}</span>
            <span className="donut-list__dot" style={{ background: item.isOther ? '#4b5563' : item.color }} />
            <span className="donut-list__name">{item.label}</span>
            <span className="donut-list__pct">%{item.pct}</span>
            <span className={`donut-list__trend${item.trend ? ` ${item.trend.className}` : ''}`}>
              {item.trend ? `${item.trend.icon} ${item.trend.pct}%` : '—'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
