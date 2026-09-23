import { useEffect, useMemo, useState } from 'react'
import { fetchCountrySummary, fetchVisibility } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import { onlyVerifiedClaims } from '../lib/claimsGate.js'

const BOYUTLAR = [
  { key: 'cultural', baslik: '1 · Kültürel & Dizi Sinyali' },
  { key: 'tourism', baslik: '2 · Turizm & Destinasyon Etkisi' },
  { key: 'export', baslik: '3 · İhracat & Ticari Veri Dengesi' },
]

const ALAN_ADLARI = {
  mediaTone: 'Olumlu medya tonu (%)',
  dominantTheme: 'Baskın tema',
  seriesCount: 'Dizi sayısı',
  scanCount: 'Basın taraması',
  arrivals: 'Son turist girişi',
  correlation: 'Korelasyon (Pearson r)',
  didEstimate: 'Fark-içinde-fark (DiD)',
  leadingSignal: 'Öncü seyahat sinyali',
  visibilityScore: 'Görünürlük skoru',
  globalRank: 'Küresel sıra',
  officialPlatformRecords: 'Resmî platform kaydı',
  licensingRevenue: 'Lisans geliri',
  dataSource: 'Veri kaynağı türü',
}

const GIZLI_ALANLAR = new Set(['sources', 'scannedSeries', 'hasOfficialPlatformData'])

function ulkeAdi(iso2) {
  return countryNames[iso2]?.name || iso2
}

/** Hesaplanan bir değer mi, hesaplanamayan mı — ikisi görsel olarak da ayrışmalı. */
function DegerHucresi({ deger }) {
  if (deger == null) return <span className="convergence__na">—</span>

  if (typeof deger !== 'object') return <span className="convergence__value">{String(deger)}</span>

  if (deger.status === 'hesaplanamaz') {
    return (
      <span className="convergence__pending" title={deger.reason}>
        <span className="badge badge--uncertain">Gerçek Veri Bekleniyor</span>
        <span className="convergence__reason">{deger.reason}</span>
      </span>
    )
  }

  const ekler = Object.entries(deger).filter(
    ([k]) => !['status', 'value', 'source', 'trust'].includes(k)
  )
  return (
    <span className="convergence__value">
      <strong>{String(deger.value)}</strong>
      {deger.trust === 'unofficial_telemetry' && (
        <span className="badge badge--uncertain" title="Korsan/telemetri kaynağı — resmî veri değildir.">
          Telemetri
        </span>
      )}
      {ekler.length > 0 && (
        <span className="convergence__meta">
          {ekler.map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </span>
      )}
    </span>
  )
}

function BoyutKarti({ baslik, veri, gozlem }) {
  const satirlar = Object.entries(veri)
    .filter(([k]) => !GIZLI_ALANLAR.has(k))
    .map(([alan, deger]) => [alan, Array.isArray(deger) ? onlyVerifiedClaims(deger) : deger])
  return (
    <section className="convergence__dimension">
      <h4 className="convergence__dimension-title">{baslik}</h4>
      <table className="convergence__table">
        <tbody>
          {satirlar.map(([alan, deger]) => (
            <tr key={alan}>
              <th>{ALAN_ADLARI[alan] || alan}</th>
              <td>
                <DegerHucresi deger={deger} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {gozlem && (
        <p className="convergence__observation">
          <span className="convergence__observation-tag">Veri gözlemi</span> {gozlem}
        </p>
      )}
    </section>
  )
}

function GuvenSiniflari({ trustClasses }) {
  return (
    <div className="convergence__trust">
      <div>
        <span className="badge badge--info">Resmî Kaynak</span>{' '}
        {trustClasses.official.length ? trustClasses.official.join(', ') : '—'}
      </div>
      <div>
        <span className="badge badge--uncertain">Gayriresmî / Telemetri</span>{' '}
        {trustClasses.unofficialTelemetry.length ? trustClasses.unofficialTelemetry.join(', ') : '—'}
      </div>
    </div>
  )
}

export default function CountryConvergencePanel() {
  const [ulkeler, setUlkeler] = useState([])
  const [iso2, setIso2] = useState('')
  const [veri, setVeri] = useState(null)
  const [durum, setDurum] = useState('idle')
  const [hata, setHata] = useState(null)
  const [gozlemDurumu, setGozlemDurumu] = useState('idle')

  useEffect(() => {
    fetchVisibility()
      .then((d) => {
        const liste = [...(d.countries || [])]
          .filter((c) => c.iso2)
          .sort((a, b) => ulkeAdi(a.iso2).localeCompare(ulkeAdi(b.iso2), 'tr'))
        setUlkeler(liste)
      })
      .catch(() => setUlkeler([]))
  }, [])

  const secili = useMemo(() => ulkeler.find((c) => c.iso2 === iso2) || null, [ulkeler, iso2])

  async function getir(kod, { withInsight = false } = {}) {
    if (!kod) return
    setDurum('loading')
    setHata(null)
    if (withInsight) setGozlemDurumu('loading')
    try {
      const d = await fetchCountrySummary(kod, { withInsight })
      setVeri(d)
      setDurum('ready')
      setGozlemDurumu(withInsight ? (d.llmSummary ? 'ready' : 'error') : 'idle')
    } catch (err) {
      setHata(err.message)
      setDurum('error')
      setGozlemDurumu('idle')
    }
  }

  return (
    <section className="convergence">
      <div className="convergence__header">
        <h3 className="dashboard__section-title">Ülke Bazlı Veri Filtreleme ve Anomali Özeti</h3>
        <p className="dashboard__hint">
          Üç sekmedeki ölçülmüş veriler tek bir ülke için birleştirilir. Bu bölüm aksiyon önerisi
          üretmez — karar verici uzmandır, burada yalnızca verinin ne gösterdiği yer alır.
        </p>
      </div>

      <div className="convergence__controls">
        <label className="convergence__label" htmlFor="convergence-country">
          Ülke
        </label>
        <select
          id="convergence-country"
          className="convergence__select"
          value={iso2}
          onChange={(e) => {
            setIso2(e.target.value)
            setVeri(null)
            setDurum('idle')
            getir(e.target.value)
          }}
        >
          <option value="">Ülke seçin…</option>
          {ulkeler.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {ulkeAdi(c.iso2)} ({c.iso2})
            </option>
          ))}
        </select>

        {/* LLM çağrısı kota harcadığı için AYRI ve bilinçli bir tetikleyici — otomatik değil. */}
        <button
          className="dashboard__export-btn dashboard__export-btn--ghost"
          disabled={!iso2 || durum === 'loading' || gozlemDurumu === 'loading'}
          onClick={() => getir(iso2, { withInsight: true })}
        >
          {gozlemDurumu === 'loading' ? 'Gözlem hazırlanıyor…' : 'Veri gözlemi ekle'}
        </button>
      </div>

      {durum === 'loading' && <div className="dashboard status">Yükleniyor…</div>}
      {durum === 'error' && <div className="dashboard status status--error">{hata || 'Veri alınamadı.'}</div>}

      {durum === 'ready' && veri && (
        <div className="convergence__body">
          <div className="convergence__summary-row">
            <h4 className="convergence__country">
              {ulkeAdi(veri.iso2)} <span className="convergence__iso">{veri.iso2}</span>
            </h4>
            {!veri.isTracked && (
              <span className="badge badge--uncertain">Bu ülke görünürlük verisinde izlenmiyor</span>
            )}
            {/* Rozet SADECE netflix_country_rankings'te gerçek satır varsa görünür — sunucu
                tarafı bunu `hasOfficialPlatformData` ile tek yerden karara bağlıyor. */}
            {veri.dimensions.export.hasOfficialPlatformData && (
              <span className="badge badge--ok" title="Netflix Top 10 kaydı mevcut — resmî platform verisi.">
                Resmî Platform Verisi Var
              </span>
            )}
            <span className="convergence__gapcount">
              {veri.dataGaps.length} alanda ölçüm yok
            </span>
          </div>

          <GuvenSiniflari trustClasses={veri.trustClasses} />

          {veri.llmError && (
            <p className="convergence__llm-error">
              Veri gözlemi üretilemedi ({veri.llmError}). Aşağıdaki ölçülmüş veriler etkilenmedi.
            </p>
          )}

          {BOYUTLAR.map((b) => (
            <BoyutKarti
              key={b.key}
              baslik={b.baslik}
              veri={veri.dimensions[b.key]}
              gozlem={veri.llmSummary?.[b.key] || null}
            />
          ))}

          {veri.dataGaps.length > 0 && (
            <details className="convergence__gaps">
              <summary>Ölçülemeyen alanlar ve gerekçeleri ({veri.dataGaps.length})</summary>
              <ul>
                {veri.dataGaps.map((g) => (
                  <li key={`${g.dimension}.${g.field}`}>
                    <strong>{ALAN_ADLARI[g.field] || g.field}</strong> — {g.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {durum === 'idle' && secili == null && (
        <p className="dashboard__empty">Birleştirilmiş veri için bir ülke seçin.</p>
      )}
    </section>
  )
}
