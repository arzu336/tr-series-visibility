const COLORS = ['#EE3135', '#22d3ee', '#f0ad4e']

// Kıyaslama Modu — server/services/trendsShareOfSearch.js'in döndürdüğü göreceli arama payını
// (shareOfSearchPct, 0-100) yatay çubuklarla gösterir. Tek bir SerpAPI çağrısında birlikte
// sorgulandıkları için (aynı zaman aralığı, aynı sorgu) çubuklar doğrudan karşılaştırılabilir.
// CountryPanel.jsx'teki RegionalInterest'in kullandığı .benchmark-card kalıbıyla aynı stil.
export default function ShareOfSearchChart({ items }) {
  if (!items || items.length === 0) return null
  const maxPct = Math.max(...items.map((i) => i.shareOfSearchPct), 1)

  return (
    <div className="benchmark-card">
      <div className="benchmark-card__bars">
        {items.map((item, i) => (
          <div key={item.title} className="benchmark-card__row">
            <div className="benchmark-card__row-label">{item.title}</div>
            <div className="benchmark-card__row-bar-track">
              <div
                className="benchmark-card__row-bar"
                style={{ width: `${(item.shareOfSearchPct / maxPct) * 100}%`, background: COLORS[i % COLORS.length] }}
              />
            </div>
            <div className="benchmark-card__row-value">%{item.shareOfSearchPct}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
