import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchTrends,
  fetchSocialListening,
  fetchTrendsTimeSeries,
  fetchTrendMovements,
  fetchMediaSentimentSummary,
  enrichSeriesNow,
  fetchSeriesEnrichJob,
  queueSeriesPress,
  waitForJob,
} from '../lib/api.js'
import { safeExternalUrl } from '../lib/safeUrl.js'
import { resolveIso2FromLabel } from '../lib/continents.js'
import { EMPTY } from '../lib/emptyStates.js'
import { useAsync } from '../lib/useAsync.js'
import countryNames from '../data/country-centroids.json'
import SeriesTrendChart from './SeriesTrendChart.jsx'
import Flag from './Flag.jsx'
import { IconChart, IconGlobe, IconMap, IconSearch, IconSparkle } from './Icons.jsx'

// Dizi sayfasındaki arama ilgisi, tanıtım ve basın bölümleri (2026-10-06: eski "Arama İlgisi → Tekli analiz"
// ekranı dizi sayfasıyla birleşti). Arama verisi ücretli bir servisten gelir: sayfa açılırken yalnızca kayıtlı
// sonuç okunur (`cachedOnly`); kayıt yoksa "Arama ilgisini sorgula" düğmesi çıkar, sorgu ancak kullanıcı
// basınca yapılır. Ülke kapsamı değiştirmek de bir kullanıcı eylemi olduğu için canlı sorgu yapabilir.

const ulkeAdi = (label) => countryNames[resolveIso2FromLabel(label)]?.name || label

function formatViews(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('tr-TR').format(n)
}

function fmtDay(ms) {
  return ms ? new Date(ms).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : null
}

/**
 * Arama ilgisi durumu: ülke kırılımı, sosyal (YouTube + izleyici beğenisi), seçili kapsamın 12 aylık serisi ve
 * yapay zekâ yorumu. `status`: loading | notCached | querying | ready | error.
 */
export function useSearchInterest(seriesName) {
  const [data, setData] = useState({ name: null, status: 'loading', result: null, social: null, error: null })
  const [geoState, setGeoState] = useState({ name: null, iso2: null })
  const [series, setSeries] = useState({ key: null, status: 'loading', timeline: null, insight: null, error: null })
  const tokenRef = useRef(0)
  const tsTokenRef = useRef(0)

  const loadSeries = useCallback(async (name, iso2, cachedOnly) => {
    const t = ++tsTokenRef.current
    const key = `${name}|${iso2 ?? ''}`
    const set = (v) => t === tsTokenRef.current && setSeries({ key, timeline: null, moves: null, error: null, ...v })
    try {
      const d = await fetchTrendsTimeSeries(name, iso2, { cachedOnly })
      if (d.notCached) return set({ status: 'notCached' })
      const ok = d.timeline?.length > 1
      set({ status: ok ? 'ready' : 'unavailable', timeline: d.timeline, movesStatus: ok ? 'loading' : null })
      if (!ok) return
      // Hareket hareket yorum (2026-10-07): önce kayıtlı yorum; yoksa kurallı notlar hemen gösterilir, yapay zekâ
      // yorumu gelince yerine geçer.
      let mv = await fetchTrendMovements(name, iso2, { cachedOnly: true }).catch(() => null)
      if (t !== tsTokenRef.current) return
      if (mv?.pending) {
        setSeries((s) => ({ ...s, moves: mv, movesStatus: 'loading' }))
        mv = (await fetchTrendMovements(name, iso2).catch(() => null)) ?? mv
      }
      if (t === tsTokenRef.current) setSeries((s) => ({ ...s, moves: mv, movesStatus: 'ready' }))
    } catch (err) {
      set({ status: 'unavailable', error: err.message })
    }
  }, [])

  const load = useCallback(
    async (name, cachedOnly) => {
      const t = ++tokenRef.current
      const [trends, social] = await Promise.all([
        fetchTrends(name, { cachedOnly }).catch((err) => ({ error: err.message })),
        fetchSocialListening(name, { cachedOnly }).catch(() => null),
      ])
      if (t !== tokenRef.current) return
      const soc = social && !social.notCached ? social : null
      if (trends.error) return setData({ name, status: 'error', error: trends.error, result: null, social: soc })
      if (trends.notCached) return setData({ name, status: 'notCached', error: null, result: null, social: soc })
      setData({ name, status: 'ready', error: null, result: trends, social: soc })
      loadSeries(name, null, cachedOnly)
    },
    [loadSeries]
  )

  useEffect(() => {
    if (seriesName) Promise.resolve().then(() => load(seriesName, true))
  }, [seriesName, load])

  const geo = geoState.name === seriesName ? geoState.iso2 : null
  const tsKey = `${seriesName}|${geo ?? ''}`
  return {
    status: data.name === seriesName ? data.status : 'loading',
    error: data.error,
    result: data.name === seriesName ? data.result : null,
    social: data.name === seriesName ? data.social : null,
    geo,
    series:
      series.key === tsKey
        ? series
        : { status: 'loading', timeline: null, moves: null, movesStatus: null, error: null },
    query: () => {
      setData((d) => ({ ...d, name: seriesName, status: 'querying' }))
      setGeoState({ name: seriesName, iso2: null })
      load(seriesName, false)
    },
    setGeo: (iso2) => {
      if (iso2 === geo) return
      setGeoState({ name: seriesName, iso2 })
      loadSeries(seriesName, iso2, false)
    },
    queryGeoSeries: () => loadSeries(seriesName, geo, false),
    reloadSocial: () =>
      fetchSocialListening(seriesName, { cachedOnly: true })
        .then((s) => setData((d) => (d.name === seriesName ? { ...d, social: s?.notCached ? null : s } : d)))
        .catch(() => {}),
  }
}

function ScopePicker({ byCountry, value, onChange, disabled }) {
  const ulkeler = [...(byCountry || [])]
    .filter((row) => row.value > 0)
    .map((row) => ({ iso2: resolveIso2FromLabel(row.country), value: row.value }))
    .filter((row) => row.iso2)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
  return (
    <div className="ts-scope">
      <span className="ts-scope__label">Grafikte göster:</span>
      <div className="ts-scope__chips">
        <button
          type="button"
          className={`ts-scope__chip${value === null ? ' ts-scope__chip--active' : ''}`}
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-pressed={value === null}
        >
          <IconGlobe size={13} inline />
          Dünya geneli
        </button>
        {ulkeler.map((row) => (
          <button
            key={row.iso2}
            type="button"
            className={`ts-scope__chip${value === row.iso2 ? ' ts-scope__chip--active' : ''}`}
            onClick={() => onChange(row.iso2)}
            disabled={disabled}
            aria-pressed={value === row.iso2}
          >
            {ulkeAdi(row.iso2)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Footprint({ byCountry }) {
  const rows = [...(byCountry || [])].filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  if (rows.length === 0) return <p className="dashboard__empty">{EMPTY.seriesNoCountryInterest}</p>
  return (
    <ul className="series-page__rows">
      {rows.slice(0, 8).map((row) => {
        const iso2 = resolveIso2FromLabel(row.country)
        return (
          <li key={row.country} className="series-page__row">
            <span className="series-page__country">
              {iso2 && <Flag iso2={iso2} />}
              {ulkeAdi(row.country)}
            </span>
            <span className="series-page__row-meta">{row.value}</span>
          </li>
        )
      })}
    </ul>
  )
}

const fmtWeek = (s) =>
  new Date(s * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Grafiğin hareket hareket yorumu: numaralar grafikteki işaretlerle aynı. */
export function TrendMoves({ moves, status }) {
  const list = moves?.movements || []
  if (status === 'loading' && !list.length)
    return <p className="dashboard__empty">Grafikteki hareketler yorumlanıyor…</p>
  if (!moves) return null
  if (!list.length) return <p className="dashboard__hint">Bu dönemde grafikte belirgin bir yükseliş ya da düşüş yok.</p>
  return (
    <div className="theme-insight__ai-box trend-moves">
      <span className="theme-insight__ai-label">
        <IconSparkle size={12} inline />
        {moves.source === 'yapay-zeka' ? 'Yapay zekâ yorumu — hareket hareket' : 'Kayıtlara göre — hareket hareket'}
        {status === 'loading' && ' · yapay zekâ yorumu hazırlanıyor…'}
      </span>
      {moves.summary && <p className="trend-moves__summary">{moves.summary}</p>}
      <ol className="trend-moves__list">
        {list.map((m, i) => (
          <li key={m.from} className="trend-moves__item">
            <span className={`trend-moves__badge trend-moves__badge--${m.kind === 'yükseliş' ? 'up' : 'down'}`}>
              {i + 1}
            </span>
            <div>
              <strong className="trend-moves__head">
                {fmtWeek(m.from)} – {fmtWeek(m.to)} · {m.kind === 'yükseliş' ? '▲' : '▼'} {m.fromValue} → {m.toValue}
              </strong>
              <p className="trend-moves__note">{m.note}</p>
              {m.events?.length > 0 && (
                <details className="trend-moves__events">
                  <summary>Bu dönemde kayıtlı gelişmeler ({m.events.length})</summary>
                  <ul>
                    {m.events.map((e) => (
                      <li key={`${e.ts}-${e.text}`}>{e.text}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function QueryCta({ text, label, onClick, busy }) {
  return (
    <div className="series-interest__cta">
      <p>{text}</p>
      <button type="button" className="series-page__btn series-page__btn--primary" onClick={onClick} disabled={busy}>
        <IconChart />
        {busy ? 'Sorgulanıyor…' : label}
      </button>
    </div>
  )
}

/** Tam genişlikte "Arama ilgisi" bölümü: solda 12 aylık seri, sağda ülkelere göre ilgi. */
export function SearchInterestSection({ si, onShowOnMap }) {
  const { status, result, series, geo } = si
  const interestCount = (result?.byCountry || []).filter((r) => r.value > 0).length
  const scope = geo ? ulkeAdi(geo) : 'Dünya geneli'
  return (
    <section className="series-page__section series-interest" id="arama-ilgisi">
      <h2>Arama ilgisi</h2>
      {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
      {(status === 'notCached' || status === 'querying') && (
        <QueryCta
          text="Bu dizi için arama ilgisi henüz sorgulanmadı. Sorgu ücretli arama servisini kullanır; sonuç bir hafta saklanır."
          label="Arama ilgisini sorgula"
          onClick={si.query}
          busy={status === 'querying'}
        />
      )}
      {status === 'error' && (
        <QueryCta text={`Arama ilgisi alınamadı: ${si.error}`} label="Yeniden dene" onClick={si.query} />
      )}
      {status === 'ready' && (
        <>
          {result?.stale && (
            <p className="series-interest__stale">
              Son ölçüm {fmtDay(result.cachedAt) ?? 'eski'}.{' '}
              <button type="button" className="dashboard__link-btn" onClick={si.query}>
                Güncelle
              </button>
            </p>
          )}
          <div className="series-interest__grid">
            <div>
              <h3 className="series-interest__title">Son 12 ay · {scope}</h3>
              <ScopePicker
                byCountry={result?.byCountry}
                value={geo}
                onChange={si.setGeo}
                disabled={series.status === 'loading'}
              />
              <p className="ts-scope__hint">
                Grafik dizinin Google'da aranma eğilimini gösterir. Bir ülke seçerseniz yalnızca o ülkedeki aramalar
                çizilir; seçenekler dizinin en çok arandığı ülkelerdir.
              </p>
              {series.status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
              {series.status === 'notCached' && (
                <QueryCta
                  text={`${scope} için 12 aylık seri henüz sorgulanmadı.`}
                  label="Seriyi sorgula"
                  onClick={si.queryGeoSeries}
                />
              )}
              {series.status === 'unavailable' && (
                <p className="dashboard__empty">
                  {series.error || EMPTY.seriesTimeSeriesMissing(geo ? `${scope} bazlı` : 'küresel')}
                </p>
              )}
              {series.status === 'ready' && (
                <>
                  <SeriesTrendChart
                    timeline={series.timeline}
                    scopeLabel={geo ? scope : null}
                    markers={(series.moves?.movements || []).map((m, i) => ({
                      timestamp: m.to,
                      label: i + 1,
                      kind: m.kind === 'yükseliş' ? 'up' : 'down',
                    }))}
                  />
                  <p className="ts-scope__note">
                    100, bu dönemdeki en yoğun arama haftasıdır; diğer haftalar ona göre ölçeklenir. Bu yüzden iki
                    ülkenin grafiği birbiriyle hacim olarak karşılaştırılamaz.
                  </p>
                  <TrendMoves moves={series.moves} status={series.movesStatus} />
                </>
              )}
            </div>
            <div>
              <h3 className="series-interest__title">
                Ülkelere göre ilgi
                {interestCount > 0 && <span className="series-page__count"> · {interestCount} ülkede ölçüldü</span>}
              </h3>
              <Footprint byCountry={result?.byCountry} />
              {interestCount > 0 && (
                <button
                  type="button"
                  className="series-page__btn series-interest__map-btn"
                  onClick={() => onShowOnMap?.(result)}
                >
                  <IconMap />
                  İlgiyi haritada göster
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/** YouTube tanıtımı (sosyal dinleme kaydından); kayıt yoksa bölüm hiç gösterilmez. */
export function PromoSection({ social }) {
  const yt = social?.youtube
  if (!yt) return null
  const videoUrl = safeExternalUrl(yt.link)
  return (
    <section className="series-page__section">
      <h2>Dizi tanıtımı</h2>
      <p className="dashboard__hint" style={{ margin: 0 }}>
        {videoUrl ? (
          <a href={videoUrl} target="_blank" rel="noreferrer" className="dashboard__link-btn">
            {yt.title}
          </a>
        ) : (
          <strong>{yt.title}</strong>
        )}
        {' — '}
        {yt.channel || 'Bilinmeyen kanal'}
        {yt.channelVerified && ' ✓'}
        {' · '}
        {formatViews(yt.views)} izlenme
        {yt.publishedDate && ` · ${yt.publishedDate}`}
      </p>
    </section>
  )
}

const TONE = { positive: 'olumlu', negative: 'olumsuz', neutral: 'nötr' }

/** Kalan süre tahmini: şimdiye kadarki ülke başı süreden. */
export function remainingText(p, startedAt, now = Date.now()) {
  if (!p?.total || !p.done || !startedAt) return null
  const perItem = (now - startedAt) / p.done
  const dk = Math.ceil((perItem * (p.total - p.done)) / 60000)
  return dk <= 1 ? 'yaklaşık 1 dk kaldı' : `yaklaşık ${dk} dk kaldı`
}

export function scanProgressText(p, startedAt, now) {
  if (!p) return 'Tarama sıraya alındı…'
  if (p.phase === 'social') return 'Basın tarandı, sosyal/YouTube verisi çekiliyor…'
  const oran = p.total ? ` (${p.done}/${p.total}${p.current ? ` · ${ulkeAdi(p.current)}` : ''})` : ''
  const kalan = remainingText(p, startedAt, now)
  return `Basın taranıyor${oran}${kalan ? ` — ${kalan}` : ''}. Tarama sunucuda sürer: sayfadan ayrılabilirsiniz, döndüğünüzde ilerleme burada görünür ve bulunan sonuçlar tarama bitmeden listeye eklenir.`
}

/**
 * Biten taramanın özeti. Yalnızca yöneticinin "tüm ülkeleri tara" işi sosyal sonucu da taşır; sayfa açılınca başlayan
 * basın taraması yalnızca basın sonucunu döndürür (2026-10-09: social yokken bu satır çöküyordu) — o durumda özet yok.
 */
export function PressSectionResult({ scan }) {
  if (scan.status !== 'done' || !scan.result?.social) return null
  const r = scan.result
  return (
    <div className="dashboard__bulk-bar" style={{ marginTop: '0.6rem' }}>
      {r.countriesTargeted} ülke hedeflendi — basın: {r.news?.scanned ?? 0} tarandı ({r.news?.liveCalls ?? 0} canlı),
      sosyal: {r.social.scanned} tarandı ({r.social.liveCalls} canlı).
      {r.social.budgetExhausted &&
        ' Sosyal tarama sırasında aylık arama kotası doldu (basın taraması ücretsiz kaynaktan sürer).'}
    </div>
  )
}

/** Basın & medya algısı; yöneticiye "tüm ülkeleri tara" (basın + sosyal) düğmesi. */
export function PressSection({ seriesId, isAdmin, onScanned }) {
  const [refresh, setRefresh] = useState(0)
  const { status, data } = useAsync(() => fetchMediaSentimentSummary(seriesId), [seriesId, refresh])
  const [scan, setScan] = useState({ status: 'idle', result: null, error: null, progress: null, startedAt: null })
  const lastDone = useRef(0)

  // İşi izler: ilerlemeyi yazar, her 3 ülkede bir özeti tazeler (bulunan haberler tarama bitmeden görünür).
  const follow = useCallback(
    async (jobId, signal) => {
      lastDone.current = 0
      try {
        const result = await waitForJob(jobId, {
          signal,
          onProgress: (j) => {
            if (signal?.aborted) return
            setScan((s) => ({ ...s, status: 'running', progress: j.progress, startedAt: j.startedAt }))
            const done = j.progress?.done ?? 0
            if (done - lastDone.current >= 3) {
              lastDone.current = done
              setRefresh((n) => n + 1)
            }
          },
        })
        if (signal?.aborted) return
        setScan({ status: 'done', result, error: null, progress: null, startedAt: null })
        setRefresh((n) => n + 1)
        onScanned?.()
      } catch (err) {
        if (!signal?.aborted)
          setScan({ status: 'error', result: null, error: err.message, progress: null, startedAt: null })
      }
    },
    [onScanned]
  )

  // Sayfa açılınca süren (yöneticinin başlattığı) tarama varsa ona bağlan. Tıklamada ücretli sorgu yapılmaz
  // (2026-10-09): taraması olmayan dizi bu geceki ön doldurma sırasına alınır, sonuç ertesi gün hazır gelir.
  const [queued, setQueued] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    fetchSeriesEnrichJob(seriesId)
      .then((r) => {
        const job = r?.job
        if (ctrl.signal.aborted || !job || (job.status !== 'running' && job.status !== 'queued')) return
        setScan({ status: 'running', result: null, error: null, progress: job.progress, startedAt: job.startedAt })
        follow(job.id, ctrl.signal)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [seriesId, follow])
  const azTarandi = status === 'ready' && (data?.status === 'pending' || (data?.scannedCount ?? 0) < 3)
  useEffect(() => {
    if (!azTarandi) return
    queueSeriesPress(seriesId)
      .then((r) => setQueued(Boolean(r?.queued)))
      .catch(() => {})
  }, [azTarandi, seriesId])

  async function handleScan() {
    setScan({ status: 'running', result: null, error: null, progress: null, startedAt: null })
    try {
      const { job } = await enrichSeriesNow(seriesId)
      await follow(job.id)
    } catch (err) {
      setScan({ status: 'error', result: null, error: err.message, progress: null, startedAt: null })
    }
  }

  return (
    <section className="series-page__section">
      <h2>Basın &amp; medya algısı</h2>
      {(status === 'loading' || status === 'idle') && <p className="dashboard__empty">Yükleniyor…</p>}
      {(status === 'error' || data?.status === 'pending') && scan.status !== 'running' && (
        <p className="dashboard__empty">{EMPTY.pressSeriesNotScanned}</p>
      )}
      {queued && data?.status !== 'pending' && (
        <p className="dashboard__hint">Bu dizi daha fazla ülkede bu gece taranacak; sonuçlar yarın burada olacak.</p>
      )}
      {status === 'ready' && data?.status === 'no-data' && scan.status !== 'running' && (
        <p className="dashboard__empty">{EMPTY.pressSeriesScannedNoNews(data.scannedCount)}</p>
      )}
      {status === 'ready' && data?.status === 'analyzing' && (
        <p className="series-page__sentiment-line">
          {data.withNewsCount} ülkede {data.newsCount} haber bulundu; ton analizi sürüyor.
        </p>
      )}
      {status === 'ready' && data?.status === 'ready' && (
        <>
          <p className="series-page__sentiment-line">
            {data.withDataCount} ülkede haber · olumlu %{data.avgPositivePct} · olumsuz %{data.avgNegativePct}
          </p>
          <ul className="series-page__chips">
            {data.countries
              .filter((c) => c.dominantSentiment && c.dominantSentiment !== 'yetersiz-veri')
              .map((c) => (
                <li key={c.iso2} className="series-page__chip">
                  <span className="series-page__country">
                    <Flag iso2={c.iso2} />
                    {countryNames[c.iso2]?.name || c.iso2}
                  </span>
                  <span className="series-page__chip-meta">{TONE[c.dominantSentiment] ?? c.dominantSentiment}</span>
                </li>
              ))}
          </ul>
        </>
      )}

      {isAdmin && (
        <div className="scan-cta">
          <div className="scan-cta__text">
            <strong>Daha fazla ülke mi taransın?</strong>
            <span>En görünür ülkelerde basın + sosyal/YouTube verisini birlikte tazeler.</span>
          </div>
          <button className="scan-cta__btn" onClick={handleScan} disabled={scan.status === 'running'}>
            {scan.status === 'running' ? (
              'Taranıyor…'
            ) : (
              <>
                <IconSearch size={15} inline />
                Tüm ülkeleri tara
              </>
            )}
          </button>
        </div>
      )}
      {scan.status === 'running' && (
        <div className="dashboard__hint" style={{ marginTop: '0.6rem' }} role="status">
          {scanProgressText(scan.progress, scan.startedAt)}
        </div>
      )}
      <PressSectionResult scan={scan} />
      {scan.status === 'error' && (
        <div className="status status--error" style={{ marginTop: '0.6rem' }}>
          Tarama başarısız: {scan.error}
        </div>
      )}
    </section>
  )
}
