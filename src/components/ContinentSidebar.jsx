import { useEffect, useMemo, useState } from 'react'
import { CONTINENTS, groupByContinent, resolveIso2FromLabel, topSeriesInContinent } from '../lib/continents.js'
import { computeSharePct, totalScoreOf } from '../lib/scoreShare.js'
import { fetchTurkishLearningIndex, fetchDuolingoStats } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function round1(n) {
  return Math.round(n * 10) / 10
}

// server/impact.js'teki PENDING_ANALYSIS ile aynı dürüstlük ilkesi: gerçek
// TÜİK/Kültür ve Turizm Bakanlığı ihracat-turizm verisi kurumsal talep dışında
// temin edilemiyor, bu yüzden burada da uydurma bir rakam üretilmiyor.
function ExportTourismPending() {
  return (
    <div className="sidebar__stat">
      <div className="sidebar__stat-label">İhracat ve Turizm Rakamları</div>
      <div className="sidebar__stat-badges">
        <span className="badge badge--uncertain">Gerçek Veri Bekleniyor</span>
      </div>
      <p className="sidebar__stat-note">
        Ülke bazlı turist girişi ve dizi ihracatı rakamları kurumsal veri talebiyle temin edilene
        kadar burada gösterilmiyor.
      </p>
    </div>
  )
}

// learningIndex.byCountry ülke adı/kod bazlı Google Trends ilgi skorunu taşır — seçili kıtadaki
// ülkelerle (iso2) kesiştirip en yüksek ilgiye sahip olanı buluyoruz.
function findTopLearningCountry(byCountry, continentCountries) {
  const iso2Set = new Set((continentCountries || []).map((c) => c.iso2))
  return byCountry
    .map((entry) => ({ ...entry, iso2: resolveIso2FromLabel(entry.country) }))
    .filter((entry) => entry.iso2 && iso2Set.has(entry.iso2))
    .sort((a, b) => b.value - a.value)[0]
}

// Lowy Institute tarzı: yoğun istatistik duvarı yerine, herkesin (üst düzey yönetici, yaşlı
// kullanıcı dahil) tek bakışta anlayabileceği 3 büyük net kart. Ayrıntılı dökümler (Top-5
// liste, ortalama skor, ihracat/turizm) silinmiyor — "Detaylı İstatistikler" altında,
// isteğe bağlı açılan ikincil bir bölümde kalıyor.
export default function ContinentSidebar({
  countries,
  onSelectCountry,
  onFocusContinent,
  collapsed,
  onToggleCollapsed,
}) {
  const continentStats = useMemo(() => groupByContinent(countries || []), [countries])
  const firstWithData = continentStats.find((c) => c.countryCount > 0)
  const [selectedId, setSelectedId] = useState(firstWithData?.id || CONTINENTS[0].id)
  const [learningIndex, setLearningIndex] = useState(null)
  const [learningStatus, setLearningStatus] = useState('loading')
  const [duolingo, setDuolingo] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    fetchTurkishLearningIndex()
      .then((res) => {
        setLearningIndex(res)
        setLearningStatus('ready')
      })
      .catch(() => setLearningStatus('unavailable'))
  }, [])

  useEffect(() => {
    fetchDuolingoStats()
      .then(setDuolingo)
      .catch(() => setDuolingo(null))
  }, [])

  const selected = continentStats.find((c) => c.id === selectedId) || continentStats[0]
  const globalTotal = useMemo(() => totalScoreOf(countries), [countries])
  const topSeries = useMemo(
    () => (selected?.countryCount > 0 ? topSeriesInContinent(selected.countries) : null),
    [selected]
  )
  const topLearningCountry = useMemo(
    () =>
      learningStatus === 'ready' && learningIndex?.byCountry?.length > 0 && selected
        ? findTopLearningCountry(learningIndex.byCountry, selected.countries)
        : null,
    [learningIndex, learningStatus, selected]
  )
  // Duolingo'nun gerçek küresel (ülke bazlı DEĞİL) momentum verisi — bkz. server/duolingo.js.
  // Kıtaya özgüymüş gibi sunulmaması için ayrı, açıkça "küresel" etiketli bir alt satır.
  const globalMomentum =
    duolingo?.status === 'ready' && duolingo.trend?.direction !== 'yetersiz-veri' ? duolingo.trend : null

  const handleSelectContinent = (id) => {
    setSelectedId(id)
    const stats = continentStats.find((c) => c.id === id)
    if (stats?.countryCount > 0) onFocusContinent?.(stats)
  }

  return (
    <div className="sidebar-wrap">
      <aside className={collapsed ? 'sidebar sidebar--collapsed' : 'sidebar'}>
        <div className="sidebar__header">
          <h3>Kıtasal Analiz</h3>
          <p className="sidebar__hint">Bir kıta seçin.</p>
        </div>

        <nav className="sidebar__continent-list">
          {continentStats.map((c) => (
            <button
              key={c.id}
              className={c.id === selectedId ? 'sidebar__continent-btn sidebar__continent-btn--active' : 'sidebar__continent-btn'}
              onClick={() => handleSelectContinent(c.id)}
              disabled={c.countryCount === 0}
            >
              <span>{c.name}</span>
              <span className="sidebar__continent-count">{c.countryCount}</span>
            </button>
          ))}
        </nav>

        {selected && selected.countryCount > 0 ? (
          <div className="sidebar__body">
            {/* Kıta Lideri */}
            <button
              className="sidebar__big-card"
              onClick={() => selected.topCountry && onSelectCountry?.(selected.topCountry.iso2)}
              title="Haritada göster"
            >
              <div className="sidebar__big-card-label">🏆 Kıta Lideri</div>
              <div className="sidebar__big-card-value">{nameOf(selected.topCountry.iso2)}</div>
              <div className="sidebar__big-card-meta">Görünürlük skoru: {round1(selected.topCountry.score)}</div>
            </button>

            {/* En Çok İzlenen Dizi */}
            <div className="sidebar__big-card">
              <div className="sidebar__big-card-label">📺 En Çok İzlenen Dizi</div>
              {topSeries ? (
                <>
                  <div className="sidebar__big-card-value">{topSeries.name}</div>
                  <div className="sidebar__big-card-meta">{topSeries.countryCount} ülkede yayında</div>
                </>
              ) : (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Veri yok</div>
              )}
            </div>

            {/* Türkçe Dil Öğrenim İlgisi */}
            <div className="sidebar__big-card">
              <div className="sidebar__big-card-label">🇹🇷 Türkçe Dil Öğrenim İlgisi</div>
              {learningStatus === 'loading' && <div className="sidebar__big-card-value sidebar__big-card-value--muted">Yükleniyor…</div>}
              {learningStatus !== 'loading' && !topLearningCountry && (
                <div className="sidebar__big-card-value sidebar__big-card-value--muted">Veri birikiyor</div>
              )}
              {topLearningCountry && (
                <>
                  <div className="sidebar__big-card-value">
                    {nameOf(topLearningCountry.iso2)} — {topLearningCountry.value}
                  </div>
                  <div className="sidebar__big-card-meta">Google Trends ilgi skoru (0-100)</div>
                </>
              )}
              {globalMomentum && (
                <div className="sidebar__big-card-meta">
                  🌍 Küresel Duolingo ivmesi: {globalMomentum.changePct > 0 ? '+' : ''}
                  {globalMomentum.changePct}% (son {globalMomentum.windowDays} gün)
                </div>
              )}
            </div>

            <button className="sidebar__details-toggle" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? '▾ Detaylı istatistikleri gizle' : '▸ Detaylı istatistikleri göster'}
            </button>

            {showDetails && (
              <div className="sidebar__details">
                <div className="sidebar__stat">
                  <div className="sidebar__stat-label">En Çok Türk Dizisi İzleyen İlk 5 Ülke</div>
                  <ol className="sidebar__top-list">
                    {selected.topCountries.map((country) => (
                      <li key={country.iso2}>
                        <button
                          className="sidebar__top-country"
                          onClick={() => onSelectCountry?.(country.iso2)}
                          title="Haritada göster"
                        >
                          <span className="sidebar__top-country-name">{nameOf(country.iso2)}</span>
                          <span className="sidebar__top-country-meta">
                            Skor: {round1(country.score)} · Kıta payı %{computeSharePct(country.score, selected.totalScore)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="sidebar__stat">
                  <div className="sidebar__stat-label" title="TMDB popülerlik puanına dayalı yakınsama (proxy) göstergesi — gerçek izlenme rakamı değildir.">
                    Kıtasal Kültürel Erişim Skoru ⓘ
                  </div>
                  <div className="sidebar__stat-value">{round1(selected.averageScore)}</div>
                  <p className="sidebar__stat-note">
                    {selected.countryCount} ülkenin ortalama görünürlük skoru · Küresel toplamın %
                    {computeSharePct(selected.totalScore, globalTotal)}'i bu kıtada.
                  </p>
                </div>

                <ExportTourismPending />
              </div>
            )}
          </div>
        ) : (
          <p className="dashboard__empty">Bu kıtada henüz görünürlük verisi yok.</p>
        )}
      </aside>

      <button
        className="sidebar-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Kıtasal analiz panelini aç' : 'Kıtasal analiz panelini kapat'}
        title={collapsed ? 'Paneli aç' : 'Paneli kapat'}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </div>
  )
}
