import { useState } from 'react'
import { fetchShareOfSearch, fetchRegionalBreakdown, fetchTrendsTimeSeries, fetchImdbData, fetchSeriesMeta } from '../lib/api.js'
import MultiSeriesTrendChart from './MultiSeriesTrendChart.jsx'

const MAX_COMPARE = 3
const POSTER_BASE = 'https://image.tmdb.org/t/p/w185'
// Kullanıcı talebi: "Mavi, Kırmızı, Yeşil" — bu SIRAYLA, seçim sırasına göre atanır (1. seçilen
// mavi, 2. kırmızı, 3. yeşil). Kırmızı zaten platformun marka rengi (#EE3135); mavi/yeşil o rengin
// yanında canlı ama çatışmayan tonlar.
const CHIP_COLORS = ['#3b82f6', '#EE3135', '#22c55e']

function CompareEmptyState() {
  return (
    <div className="compare-empty">
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <circle cx="36" cy="36" r="34" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <rect x="20" y="38" width="8" height="18" rx="2" fill="currentColor" fillOpacity="0.55" />
        <rect x="34" y="26" width="8" height="30" rx="2" fill="currentColor" fillOpacity="0.8" />
        <rect x="48" y="32" width="8" height="24" rx="2" fill="currentColor" fillOpacity="0.4" />
      </svg>
      <p>Karşılaştırmak için yukarıdan en az 2 dizi seçin</p>
    </div>
  )
}

// Blok — Head-to-Head kartları. Her metrik (Puan/Pazar Payı/Ülke Sayısı) kendi içinde en yüksek
// değere sahip kart(lar)ı "▲ Lider" ile işaretler — eşitlik olursa hepsi işaretlenir, tek bir
// kazanan uydurulmaz.
function Head2HeadCard({ card, isRatingLeader, isShareLeader, isCountryLeader }) {
  return (
    <div className="h2h-card" style={{ '--h2h-color': card.color }}>
      <div className="h2h-card__stripe" />
      <div className="h2h-card__body">
        {card.meta?.posterPath ? (
          <img className="h2h-card__poster" src={`${POSTER_BASE}${card.meta.posterPath}`} alt="" />
        ) : (
          <div className="h2h-card__poster h2h-card__poster--empty">Afiş yok</div>
        )}
        <h4 className="h2h-card__title">{card.name}</h4>

        <div className="h2h-card__metric">
          <span className="h2h-card__metric-label">IMDb Puanı</span>
          <span className="h2h-card__metric-value">
            {card.imdbRating != null ? `⭐ ${card.imdbRating.toFixed(1)}` : '—'}
            {isRatingLeader && <span className="h2h-card__leader">▲ Lider</span>}
          </span>
        </div>
        <div className="h2h-card__metric">
          <span className="h2h-card__metric-label" title="Seçilen diziler arasındaki göreceli, küresel arama payı">
            Global Pazar Payı
          </span>
          <span className="h2h-card__metric-value">
            {card.sharePct != null ? `%${card.sharePct}` : '—'}
            {isShareLeader && <span className="h2h-card__leader">▲ Lider</span>}
          </span>
        </div>
        <div className="h2h-card__metric">
          <span
            className="h2h-card__metric-label"
            title="Karşılaştırmalı Google Trends verisinde bu dizinin sıfırdan büyük bir arama payı aldığı ülke sayısı — erişim/izlenme değil"
          >
            Pay Aldığı Ülke Sayısı
          </span>
          <span className="h2h-card__metric-value">
            {card.countryCount ?? '—'}
            {isCountryLeader && <span className="h2h-card__leader">▲ Lider</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

// TEK SerpAPI çağrısından (getRegionalBreakdown) gelen `compared_breakdown_by_region` verisi.
// DÜRÜSTLÜK NOTU: bu değerler mutlak ilgi DEĞİL, her ülke İÇİNDE karşılaştırılan diziler
// arasındaki yüzde payıdır (bir ülkenin satırındaki değerler toplamı 100). Bu yüzden:
// (1) çubuk genişliği doğrudan yüzdedir, satır içi bir maksimuma göre değil;
// (2) değerler "%" ile yazılır; (3) ülkeler arası mutlak hacim karşılaştırması yapılmaz —
// sıralama, ilk seçilen dizinin payına göredir (bkz. trendsShareOfSearch.js).
function RegionalDominanceTable({ topRows, cards }) {
  if (topRows.length === 0) {
    return <p className="dashboard__empty">Seçilen diziler için ülke bazlı karşılaştırma verisi bulunamadı.</p>
  }
  return (
    <div className="regional-dominance">
      {topRows.map((row) => {
        return (
          <div key={row.iso2} className="regional-dominance__row">
            <div className="regional-dominance__label">{row.location || row.iso2}</div>
            <div className="regional-dominance__bars">
              {cards.map((c) => {
                const value = row.values.find((v) => v.title === c.name)?.value ?? 0
                return (
                  <div key={c.id} className="regional-dominance__bar-row">
                    <div className="regional-dominance__bar-track" title={`${c.name}: %${value}`}>
                      <div className="regional-dominance__bar" style={{ width: `${value}%`, background: c.color }} />
                    </div>
                    {/* Değer görünür yazılıyor — bar sıfır genişlikteyken (o ülkede bu diziye
                        düşen pay yoksa) boş bir çubuk "bozuk" gibi görünmesin, dürüstçe %0 yazsın. */}
                    <span className="regional-dominance__bar-value">%{value}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="regional-dominance__legend">
        {cards.map((c) => (
          <span key={c.id} className="lag-chart__legend-item">
            <span className="lag-chart__swatch" style={{ background: c.color }} />
            {c.name}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ComparisonView({ seriesList }) {
  const [picked, setPicked] = useState([]) // [{id, name}]
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [error, setError] = useState(null)
  const [cards, setCards] = useState([])
  const [regionalRows, setRegionalRows] = useState([])

  function addSeries(name) {
    const s = seriesList.find((s) => s.name === name)
    if (!s || picked.length >= MAX_COMPARE || picked.some((p) => p.id === s.id)) return
    setPicked((prev) => [...prev, s])
    setQuery('')
    setStatus('idle')
  }

  function removeSeries(id) {
    setPicked((prev) => prev.filter((p) => p.id !== id))
    setStatus('idle')
  }

  async function handleCompare() {
    setStatus('loading')
    setError(null)
    try {
      const names = picked.map((p) => p.name)
      const [share, regional] = await Promise.all([fetchShareOfSearch(names), fetchRegionalBreakdown(names)])
      const shareByTitle = new Map(share.items.map((i) => [i.title, i.shareOfSearchPct]))

      const perSeries = await Promise.all(
        picked.map(async (p, i) => {
          const [timeseries, imdb, meta] = await Promise.all([
            fetchTrendsTimeSeries(p.name).catch(() => null),
            fetchImdbData(p.id).catch(() => null),
            fetchSeriesMeta(p.id).catch(() => null),
          ])
          return {
            id: p.id,
            name: p.name,
            color: CHIP_COLORS[i],
            meta,
            imdbRating: imdb?.status === 'ready' ? imdb.rating : null,
            sharePct: shareByTitle.get(p.name) ?? null,
            countryCount: regional.countryCountByTitle?.[p.name] ?? null,
            timeline: timeseries?.timeline || [],
          }
        })
      )
      setCards(perSeries)
      setRegionalRows(regional.topRows || [])
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const ratings = cards.map((c) => c.imdbRating).filter((v) => v != null)
  const maxRating = ratings.length ? Math.max(...ratings) : null
  const shares = cards.map((c) => c.sharePct).filter((v) => v != null)
  const maxShare = shares.length ? Math.max(...shares) : null
  const countryCounts = cards.map((c) => c.countryCount).filter((v) => v != null)
  const maxCountryCount = countryCounts.length ? Math.max(...countryCounts) : null

  return (
    <div>

      <div className="chip-selector">
        <div className="chip-selector__chips">
          {picked.map((p, i) => (
            <span key={p.id} className="chip" style={{ '--chip-color': CHIP_COLORS[i] }}>
              <span className="chip__dot" />
              {p.name}
              <button className="chip__remove" onClick={() => removeSeries(p.id)} aria-label={`${p.name} kaldır`}>
                ×
              </button>
            </span>
          ))}
        </div>
        {picked.length < MAX_COMPARE && (
          <div className="trends__controls" style={{ marginBottom: 0 }}>
            <input
              className="search-input"
              list="compare-series-list"
              type="text"
              placeholder={picked.length === 0 ? 'Bir dizi ara ve seç…' : 'Başka bir dizi daha ekle…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && seriesList.some((s) => s.name === query)) addSeries(query)
              }}
            />
            <datalist id="compare-series-list">
              {seriesList.filter((s) => !picked.some((p) => p.id === s.id)).map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <button onClick={() => addSeries(query)} disabled={!seriesList.some((s) => s.name === query)}>
              Ekle
            </button>
          </div>
        )}
        {picked.length >= MAX_COMPARE && <p className="dashboard__hint" style={{ margin: 0 }}>En fazla {MAX_COMPARE} dizi seçilebilir.</p>}
      </div>

      <div className="trends__controls">
        <button onClick={handleCompare} disabled={picked.length < 2 || status === 'loading'}>
          {status === 'loading' ? 'Karşılaştırılıyor…' : `Karşılaştır (${picked.length}/${MAX_COMPARE})`}
        </button>
      </div>

      {status === 'error' && <div className="status status--error">Hata: {error}</div>}

      {picked.length < 2 && status !== 'loading' && <CompareEmptyState />}

      {status === 'ready' && cards.length > 0 && (
        <>
          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Baş Başa Karşılaştırma</h3>
            <div className="h2h-grid">
              {cards.map((c) => (
                <Head2HeadCard
                  key={c.id}
                  card={c}
                  isRatingLeader={c.imdbRating != null && c.imdbRating === maxRating}
                  isShareLeader={c.sharePct != null && c.sharePct === maxShare}
                  isCountryLeader={c.countryCount != null && c.countryCount === maxCountryCount}
                />
              ))}
            </div>
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Küresel Zaman Serisi Karşılaştırması</h3>
            <MultiSeriesTrendChart series={cards.map((c) => ({ name: c.name, color: c.color, timeline: c.timeline }))} />
          </section>

          <section className="dashboard__section">
            <h3 className="dashboard__section-title">Karşılaştırılan Dizilerin Ülke İçi İlgi Payı</h3>
            <RegionalDominanceTable topRows={regionalRows} cards={cards} />
          </section>
        </>
      )}
    </div>
  )
}
