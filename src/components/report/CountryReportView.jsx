import { fetchCountryReport } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { usePrintWhenReady } from '../../lib/usePrintWhenReady.js'
import CountryReportDocument from './CountryReportDocument.jsx'
import { IconBack, IconPrint } from '../Icons.jsx'

// Ülke raporu görünümü: tek ortak rapor (profil yok), "PDF olarak indir".
// Baskı: usePrintWhenReady yükleme göstergesi (.report__loading) kalmayınca window.print() çağırır;
// hazırlanırken .report--printing sınıfı ekranda da açık baskı temasını gösterir (önizleme).
export default function CountryReportView({ iso2, countryName, onBack }) {
  const reportReq = useAsync(() => fetchCountryReport(iso2), [iso2], { keepPrevious: true })
  const { printAreaRef, printing, requestPrint } = usePrintWhenReady({ pendingSelector: '.report__loading' })
  const hazir = reportReq.status === 'ready' && reportReq.data?.iso2 === iso2

  return (
    <div className={`report${printing ? ' dashboard--printing report--printing' : ''}`} ref={printAreaRef}>
      <div className="report__toolbar">
        {onBack && (
          <button
            type="button"
            className="series-page__back report__back"
            onClick={onBack}
            aria-label="Haritaya geri dön"
          >
            <IconBack />
            Harita
          </button>
        )}
        <button
          type="button"
          className="dashboard__export-btn report__print"
          onClick={requestPrint}
          disabled={printing || !hazir}
          aria-label="Raporu PDF olarak indir (yazdırma önizlemesi açılır)"
        >
          {printing ? (
            'Önizleme hazırlanıyor…'
          ) : (
            <>
              <IconPrint size={15} inline />
              PDF olarak indir
            </>
          )}
        </button>
      </div>

      {reportReq.status === 'loading' && (
        <p className="report__loading dashboard__empty" role="status" aria-live="polite">
          {countryName} raporu hazırlanıyor…
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
