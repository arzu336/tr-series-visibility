import { useState } from 'react'
import { fetchCountryReport, fetchReportProfiles } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { usePrintWhenReady } from '../../lib/usePrintWhenReady.js'
import ProfilePicker from './ProfilePicker.jsx'
import CountryReportDocument from './CountryReportDocument.jsx'

// Ülke raporu görünümü: profil seçimi (yetki sunucudan gelir), rapor çekimi, "PDF olarak indir".
// Baskı: usePrintWhenReady yükleme göstergesi (.report__loading) kalmayınca window.print() çağırır;
// hazırlanırken .report--printing sınıfı ekranda da açık baskı temasını gösterir (önizleme).
export default function CountryReportView({ iso2, countryName, onBack }) {
  const profilesReq = useAsync(fetchReportProfiles, [])
  const profiles = profilesReq.data?.profiles ?? []
  const [secim, setSecim] = useState(null)
  const profile = secim ?? profiles.find((p) => p.allowed)?.id ?? null

  const reportReq = useAsync(() => fetchCountryReport(iso2, profile), [iso2, profile], {
    enabled: Boolean(profile),
    keepPrevious: true,
  })
  const { printAreaRef, printing, requestPrint } = usePrintWhenReady({ pendingSelector: '.report__loading' })

  const yukleniyor = profilesReq.status === 'loading' || reportReq.status === 'loading'
  const hazir = reportReq.status === 'ready' && reportReq.data?.profile === profile

  return (
    <div
      className={`dashboard report${printing ? ' dashboard--printing report--printing' : ''}${profile ? ` report--${profile}` : ''}`}
      ref={printAreaRef}
    >
      <div className="report__toolbar">
        <button
          type="button"
          className="dashboard__export-btn dashboard__export-btn--ghost report__back"
          onClick={onBack}
          aria-label="Haritaya geri dön"
        >
          ← Harita
        </button>
        {profilesReq.status === 'ready' && (
          <ProfilePicker profiles={profiles} value={profile} onChange={setSecim} disabled={printing} />
        )}
        {profilesReq.status === 'error' && (
          <p className="report__error" role="alert">
            Profiller alınamadı: {profilesReq.error}
          </p>
        )}
        <button
          type="button"
          className="dashboard__export-btn report__print"
          onClick={requestPrint}
          disabled={printing || !hazir}
          aria-label="Raporu PDF olarak indir (yazdırma önizlemesi açılır)"
        >
          {printing ? 'Önizleme hazırlanıyor…' : '🖨 PDF olarak indir'}
        </button>
      </div>

      {profilesReq.status === 'ready' && !profile && (
        <p className="report__error" role="alert">
          Hesabınızın erişebildiği bir rapor profili yok.
        </p>
      )}
      {yukleniyor && (
        <p className="report__loading dashboard__empty" role="status" aria-live="polite">
          {profilesReq.status === 'loading' ? 'Profiller yükleniyor…' : `${countryName} raporu hazırlanıyor…`}
        </p>
      )}
      {reportReq.status === 'error' && (
        <p className="report__error" role="alert">
          Rapor alınamadı: {reportReq.error}
        </p>
      )}
      {reportReq.data && (
        <div className={hazir ? undefined : 'report__doc-wrap--stale'} aria-busy={!hazir}>
          <CountryReportDocument report={reportReq.data} countryName={countryName} />
        </div>
      )}
    </div>
  )
}
