import { useEffect, useState } from 'react'
import { fetchTrendSeriesList } from '../lib/api.js'
import ComparisonView from './ComparisonView.jsx'
import { IconSearch } from './Icons.jsx'
import { SeriesQuickPicks, topSeries } from './QuickPicks.jsx'

// Arama İlgisi sekmesi. Tek dizinin analizi 2026-10-06'da dizi sayfasıyla birleşti: burada dizi aramak o dizinin
// sayfasını açar (arama ilgisi bölümü orada). Bu sekmede kalan iş kıyaslama: 2–3 dizi yan yana.
export default function TrendsExplorer({ onOpenSeries, countries = [] }) {
  const [seriesList, setSeriesList] = useState([])
  const [listStatus, setListStatus] = useState('loading')
  const [listError, setListError] = useState(null)
  const [mode, setMode] = useState('single')
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetchTrendSeriesList()
      .then((data) => {
        setSeriesList(data.items)
        setListStatus('idle')
      })
      .catch((err) => {
        setListError(err.message)
        setListStatus('error')
      })
  }, [])

  const match = seriesList.find((s) => s.name === query)
  const open = () => match && onOpenSeries?.(match.id)

  return (
    <div className="dashboard">
      <h2>Dizi Derin Analiz &amp; Karşılaştırma Laboratuvarı</h2>
      <p className="dashboard__hint">Talep üzerine sorgulanır, sonuç kalıcı olarak önbelleklenir.</p>

      {listStatus === 'error' && <div className="status status--error">Hata: {listError}</div>}

      {listStatus !== 'error' && (
        <>
          <div className="period-toggle" role="group" aria-label="Analiz modu">
            <button
              className={mode === 'single' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
              onClick={() => setMode('single')}
            >
              Tekli Analiz
            </button>
            <button
              className={mode === 'compare' ? 'period-toggle__btn period-toggle__btn--active' : 'period-toggle__btn'}
              onClick={() => setMode('compare')}
            >
              Kıyaslama Modu
            </button>
          </div>

          {mode === 'single' ? (
            <>
              <div className="trends__controls">
                <input
                  aria-label="Bir dizi ara ve seç"
                  className="search-input"
                  list="trends-series-list"
                  type="text"
                  placeholder="Bir dizi ara ve seç…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => e.key === 'Enter' && open()}
                />
                <datalist id="trends-series-list">
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
                <button onClick={open} disabled={!match}>
                  <IconSearch size={14} inline />
                  Dizi sayfasını aç
                </button>
              </div>
              <p className="dashboard__empty">
                Dizinin arama ilgisi, ülkelere göre ilgisi, basın algısı ve diğer bilgileri dizi sayfasında açılır.
              </p>
              <SeriesQuickPicks countries={countries} onPick={(id) => onOpenSeries?.(id)} />
            </>
          ) : (
            <ComparisonView seriesList={seriesList} suggestions={topSeries(countries, 8)} />
          )}
        </>
      )}
    </div>
  )
}
