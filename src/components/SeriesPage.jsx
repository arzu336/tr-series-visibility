import { useMemo } from 'react'
import { IconBack, IconMap, IconChart, IconStar, IconReport } from './Icons.jsx'
import EpisodeHeatmap from './EpisodeHeatmap.jsx'
import {
  fetchImdbData,
  fetchSeriesEnrichment,
  fetchSeriesCharts,
  fetchSeriesMeta,
  fetchMagazineNews,
  fetchSeriesCast,
} from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'
import CastBar from './CastBar.jsx'
import { MagazineCarousel, visibleMagazineItems } from './MagazineNews.jsx'
import Flag from './Flag.jsx'
import { fmtDateTr } from './ChartList.jsx'
import { AVAILABILITY_NOTE } from '../lib/methodologyNotes.js'
import countryNames from '../data/country-centroids.json'
import { useSearchInterest, SearchInterestSection, PromoSection, PressSection } from './SeriesSearchInterest.jsx'
import SeriesYoutube from './SeriesYoutube.jsx'
import { SeriesTv } from './TvSections.jsx'

// Dizi sayfası: haritadaki sağ panel kısa özet için; dizi hakkında her şey burada (listeler, nerede yayında,
// arama ilgisi, uluslararası isimler, magazin, kadro, basın algısı). Adresi ?dizi=<tmdbId> — geri tuşu haritaya
// döner. Arama İlgisi sekmesinde dizi aramak da bu sayfayı açar (2026-10-06'da iki ekran birleşti).

const POSTER_BASE = 'https://image.tmdb.org/t/p/w342'

/** Sayfa içi yönlendirme: üstteki özet çipleri ilgili bölüme kaydırır. */
function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function JumpPill({ target, children, title }) {
  return (
    <button
      type="button"
      className="map-popup-card__pill map-popup-card__pill--link"
      onClick={() => scrollToSection(target)}
      title={title}
    >
      {children}
    </button>
  )
}

function nameOf(iso2) {
  return countryNames[iso2]?.name || iso2
}

function formatVotes(n) {
  if (n == null) return null
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

const TR_FOLD = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }
const foldTitle = (t) =>
  String(t || '')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_FOLD[ch])
    .replace(/[^a-z0-9]+/g, '')

/**
 * IMDb yerel adları → aynı adı kullanan ülkeler tek satırda. Türkçe adın aynısı ya da yalnızca Türkçe
 * karakterleri düşürülmüş hâli ("Kurulus: Osman") bilgi taşımadığı için gösterilmez. Çok ülkede kullanılan ad önce.
 */
export function groupLocalizedTitles(localized, turkishName) {
  const own = foldTitle(turkishName)
  const byTitle = new Map()
  for (const { region, title } of localized || []) {
    if (region === 'TR' || foldTitle(title) === own) continue
    if (!byTitle.has(title)) byTitle.set(title, [])
    if (!byTitle.get(title).includes(region)) byTitle.get(title).push(region)
  }
  return [...byTitle.entries()]
    .map(([title, regions]) => ({ title, regions: regions.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'tr')) }))
    .sort((a, b) => b.regions.length - a.regions.length || a.title.localeCompare(b.title, 'tr'))
}

function Country({ iso2 }) {
  return (
    <span className="series-page__country">
      <Flag iso2={iso2} />
      {nameOf(iso2)}
    </span>
  )
}

/** Dizinin haritadaki verisinden: temel bilgiler + yayında olduğu ülkeler (o ülkedeki platformlarıyla). */
export function seriesFromCountries(allCountries, seriesId) {
  let base = null
  const availability = []
  for (const c of allCountries || []) {
    const match = c.seriesList?.find((s) => s.id === seriesId)
    if (!match) continue
    if (!base) base = match
    availability.push({ iso2: c.iso2, platforms: match.platforms || [] })
  }
  availability.sort((a, b) => nameOf(a.iso2).localeCompare(nameOf(b.iso2), 'tr'))
  return base ? { ...base, availability } : null
}

/** Ülke başına tek satır: bütün listeler birlikte (platform adı gösterilmez) — en iyi sıra, en uzun süre, son tarih. */
export function mergeListingsByCountry(listings) {
  const by = new Map()
  for (const l of listings || []) {
    const cur = by.get(l.iso2)
    if (!cur) by.set(l.iso2, { iso2: l.iso2, bestRank: l.bestRank, weeks: l.weeks, lastDate: l.lastDate })
    else {
      cur.bestRank = Math.min(cur.bestRank, l.bestRank)
      cur.weeks = Math.max(cur.weeks, l.weeks)
      if (l.lastDate > cur.lastDate) cur.lastDate = l.lastDate
    }
  }
  return [...by.values()].sort((a, b) =>
    b.lastDate > a.lastDate ? 1 : b.lastDate < a.lastDate ? -1 : a.bestRank - b.bestRank
  )
}

function ListingsTable({ listings }) {
  return (
    <div className="series-page__table-wrap">
      <table className="series-page__table">
        <thead>
          <tr>
            <th>Ülke</th>
            <th>En iyi sıra</th>
            <th>Hafta</th>
            <th>Son</th>
          </tr>
        </thead>
        <tbody>
          {mergeListingsByCountry(listings).map((l) => (
            <tr key={l.iso2}>
              <td>
                <Country iso2={l.iso2} />
              </td>
              <td>#{l.bestRank}</td>
              <td>{l.weeks}</td>
              <td>{fmtDateTr(l.lastDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Ana kadro: tüm sezonlar, oynadığı bölüm sayısına göre sıralı (sunucu /api/series/:id/cast). Tek satırda
 * yatay kaydırılır. Yüklenirken katalogdaki kısa kadro (5 kişi) gösterilir.
 */
function SeriesCast({ seriesId, fallback = [], onSelectActor }) {
  const { status, data } = useAsync(() => fetchSeriesCast(seriesId), [seriesId], { enabled: seriesId != null })
  const cast = status === 'ready' && data?.cast?.length ? data.cast : fallback
  if (!cast?.length && status !== 'loading') return null
  return (
    <section className="series-page__section">
      <h2>
        Kadro
        {status === 'ready' && cast.length > 0 && <span className="series-page__count"> · {cast.length} kişi</span>}
      </h2>
      <CastBar cast={cast} onSelectActor={onSelectActor} scroll />
    </section>
  )
}

export default function SeriesPage({
  seriesId,
  allCountries,
  onBack,
  backLabel = 'Haritaya dön',
  onShowOnMap,
  onSelectActor,
  onShowInterestOnMap,
  onOpenReport,
  isAdmin = false,
}) {
  const fromCountries = useMemo(() => seriesFromCountries(allCountries, seriesId), [allCountries, seriesId])
  const metaReq = useAsync(() => fetchSeriesMeta(seriesId), [seriesId], { enabled: seriesId != null })
  // Hiçbir yayın platformunda olmayan diziler (ör. katalog tamamlamayla eklenen eski TV dizileri) ülke yayın
  // listelerinde yoktur; o durumda dizinin katalog kaydı kullanılır, "Nerede yayında" boş kalır.
  const series =
    fromCountries ?? (metaReq.status === 'ready' && metaReq.data ? { ...metaReq.data, availability: [] } : null)
  const imdbReq = useAsync(() => fetchImdbData(seriesId), [seriesId], { enabled: seriesId != null })
  const enrichment = useAsync(() => fetchSeriesEnrichment(seriesId), [seriesId], { enabled: seriesId != null }).data
  const chartsReq = useAsync(() => fetchSeriesCharts(seriesId), [seriesId], { enabled: seriesId != null })
  const meta = metaReq.status === 'ready' ? metaReq.data : null
  const imdb = imdbReq.status === 'ready' && imdbReq.data?.status === 'ready' ? imdbReq.data : null
  const charts = chartsReq.status === 'ready' ? chartsReq.data : null
  const listings = charts?.listings || []
  const magazineReq = useAsync(() => fetchMagazineNews(seriesId), [seriesId], { enabled: seriesId != null })
  const magazineItems = visibleMagazineItems(magazineReq.data?.items, 10)
  const si = useSearchInterest(series?.name)
  const kg = si.social?.knowledgeGraph

  if (!series) {
    const loading = metaReq.status === 'loading' || metaReq.status === 'idle'
    return (
      <div className="series-page">
        <button type="button" className="series-page__back" onClick={onBack}>
          <IconBack />
          {backLabel}
        </button>
        <p className="dashboard__empty">{loading ? 'Yükleniyor…' : 'Bu dizi için veri bulunamadı.'}</p>
      </div>
    )
  }

  const handleShowOnMap = () => {
    // Haritada vurgu: listeye girdiği ülkeler (en çok hafta); liste kaydı yoksa yayında olduğu ülkeler.
    const weeksByIso2 = new Map()
    for (const l of listings) weeksByIso2.set(l.iso2, Math.max(weeksByIso2.get(l.iso2) ?? 0, l.weeks))
    const entries = weeksByIso2.size
      ? [...weeksByIso2].map(([iso2, weeks]) => ({ iso2, weeks }))
      : series.availability.map((c) => ({ iso2: c.iso2, weeks: null }))
    onShowOnMap?.(series.name, entries)
  }

  const year = series.firstAirDate ? series.firstAirDate.slice(0, 4) : null
  const listedCountries = new Set(listings.map((l) => l.iso2)).size
  const localized = groupLocalizedTitles(enrichment?.imdb?.localizedTitles, series?.name)
  const crew = enrichment?.imdb?.crew
  const seasons = enrichment?.imdb?.seasons || []

  return (
    <div className="series-page">
      <button type="button" className="series-page__back" onClick={onBack}>
        <IconBack />
        {backLabel}
      </button>

      <header className="series-page__header">
        {series.posterPath ? (
          <img className="series-page__poster" src={`${POSTER_BASE}${series.posterPath}`} alt="" />
        ) : (
          <span className="series-page__poster series-page__poster--empty" aria-hidden="true" />
        )}
        <div className="series-page__intro">
          <h1 className="series-page__title">{series.name}</h1>
          <p className="series-page__meta">
            {[year, series.theme, meta?.totalEpisodes ? `${meta.totalEpisodes} bölüm` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="series-page__pills">
            {imdb?.rating != null &&
              (seasons.length > 0 ? (
                <JumpPill target="bolum-puanlari" title="Bölüm puanlarına git">
                  <IconStar />
                  {imdb.rating.toFixed(1)}
                  {imdb.votes != null ? ` (${formatVotes(imdb.votes)} oy)` : ''}
                </JumpPill>
              ) : (
                <span className="map-popup-card__pill">
                  <IconStar />
                  {imdb.rating.toFixed(1)}
                  {imdb.votes != null ? ` (${formatVotes(imdb.votes)} oy)` : ''}
                </span>
              ))}
            {imdb?.votesGrowth?.d7?.votes > 0 && (
              <span
                className="map-popup-card__pill series-page__pill--up"
                title={`IMDb'de son ${imdb.votesGrowth.d7.days} günde eklenen oy`}
              >
                +{formatVotes(imdb.votesGrowth.d7.votes)} oy · {imdb.votesGrowth.d7.days} gün
              </span>
            )}
            {enrichment?.dizilah?.channel && <span className="map-popup-card__pill">{enrichment.dizilah.channel}</span>}
            <JumpPill target="nerede-yayinda" title="Yayında olduğu ülkelere git">
              {series.availability.length} ülkede yayında
            </JumpPill>
            {listedCountries > 0 && (
              <JumpPill target="listeler" title="Listelere git">
                {listedCountries} ülkede listede
              </JumpPill>
            )}
            {kg?.userReviewsPct != null && (
              <span className="map-popup-card__pill">İzleyici beğenisi %{kg.userReviewsPct}</span>
            )}
            {(kg?.ratings || []).map((r) => (
              <span key={r.source} className="map-popup-card__pill">
                {r.source}: {r.rating}
              </span>
            ))}
          </div>
          {(crew?.directors?.length > 0 || crew?.writers?.length > 0) && (
            <p className="series-page__crew">
              {crew.directors.length > 0 && (
                <span>
                  <strong>Yönetmen:</strong> {crew.directors.map((d) => d.name).join(', ')}
                </span>
              )}
              {crew.writers.length > 0 && (
                <span>
                  <strong>Senaryo:</strong> {crew.writers.map((w) => w.name).join(', ')}
                </span>
              )}
            </p>
          )}
          {(meta?.overview || series.overview) && (
            <p className="series-page__overview">{meta?.overview || series.overview}</p>
          )}
          <div className="series-page__actions">
            <button type="button" className="series-page__btn series-page__btn--primary" onClick={handleShowOnMap}>
              <IconMap />
              Haritada göster
            </button>
            <button type="button" className="series-page__btn" onClick={() => scrollToSection('arama-ilgisi')}>
              <IconChart />
              Arama ilgisi
            </button>
            {onOpenReport && (
              <button type="button" className="series-page__btn" onClick={() => onOpenReport(seriesId)}>
                <IconReport />
                Dizi raporu
              </button>
            )}
          </div>
        </div>
      </header>

      <SearchInterestSection si={si} onShowOnMap={onShowInterestOnMap} />

      <div className="series-page__grid">
        <div className="series-page__col">
          <section className="series-page__section" id="listeler">
            <h2>Listeler</h2>
            {chartsReq.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
            {charts && listings.length > 0 && <ListingsTable listings={listings} />}
            {charts && listings.length === 0 && (
              <p className="dashboard__empty">Bu dizi takip ettiğimiz hiçbir listeye girmedi.</p>
            )}
          </section>

          <section className="series-page__section" id="nerede-yayinda">
            <h2 title={AVAILABILITY_NOTE}>Nerede yayında — {series.availability.length} ülke ⓘ</h2>
            {series.availability.length ? (
              <ul className="series-page__rows">
                {series.availability.map((c) => (
                  <li key={c.iso2} className="series-page__row">
                    <Country iso2={c.iso2} />
                    <span className="series-page__row-meta">{c.platforms.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dashboard__empty">Bu dizi şu an hiçbir yayın platformunda bulunmuyor.</p>
            )}
          </section>

          <SeriesTv seriesId={seriesId} />

          {seasons.length > 0 && (
            <section className="series-page__section" id="bolum-puanlari">
              <h2>Bölüm puanları</h2>
              <EpisodeHeatmap seasons={seasons} />
            </section>
          )}
        </div>

        <div className="series-page__col">
          <section className="series-page__section series-page__section--magazine">
            <h2>Magazin</h2>
            {magazineReq.status === 'loading' || magazineReq.status === 'idle' ? (
              <p className="dashboard__empty">Haberler yükleniyor…</p>
            ) : magazineReq.status === 'error' ? (
              <p className="dashboard__empty">Haberler şu an alınamadı.</p>
            ) : (
              <MagazineCarousel items={magazineItems} />
            )}
          </section>

          <PromoSection social={si.social} />

          <SeriesYoutube seriesId={seriesId} />

          <SeriesCast seriesId={seriesId} fallback={series.cast} onSelectActor={onSelectActor} />

          {localized.length > 0 && (
            <section className="series-page__section">
              <h2>Uluslararası adları</h2>
              <ul className="series-page__rows">
                {localized.map((lt) => (
                  <li key={lt.title} className="series-page__row series-page__row--title">
                    <span className="series-page__aka">{lt.title}</span>
                    <span className="series-page__aka-flags">
                      {lt.regions.map((r) => (
                        <Flag key={r} iso2={r} title={nameOf(r)} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PressSection seriesId={seriesId} isAdmin={isAdmin} onScanned={si.reloadSocial} />
        </div>
      </div>
    </div>
  )
}
