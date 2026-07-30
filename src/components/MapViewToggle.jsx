export default function MapViewToggle({ value, onChange }) {
  return (
    <div className="map-view-toggle" role="group" aria-label="Harita görünümü">
      <button
        className={value === '3d' ? 'map-view-toggle__btn map-view-toggle__btn--active' : 'map-view-toggle__btn'}
        onClick={() => onChange('3d')}
      >
        3D Küre
      </button>
      <button
        className={value === '2d' ? 'map-view-toggle__btn map-view-toggle__btn--active' : 'map-view-toggle__btn'}
        onClick={() => onChange('2d')}
      >
        2D Harita
      </button>
    </div>
  )
}
