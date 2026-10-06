import { fetchGlobalReport } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { usePrintWhenReady } from '../../lib/usePrintWhenReady.js'
import CountryReportDocument from './CountryReportDocument.jsx'
import { IconPrint } from '../Icons.jsx'

// Küresel görünüm: ülke brifingi ve dizi raporuyla aynı belge bileşeni (özet → başlıklar → ek) ve aynı PDF akışı.
export default function GlobalReportView() {
  const reportReq = useAsync(() => fetchGlobalReport(), [])
  const { printAreaRef, printing, requestPrint } = usePrintWhenReady({ pendingSelector: '.report__loading' })
  const hazir = reportReq.status === 'ready'

  return (
    <div className={`report${printing ? ' dashboard--printing report--printing' : ''}`} ref={printAreaRef}>
      <div className="report__toolbar">
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
          Küresel görünüm hazırlanıyor…
        </p>
      )}
      {reportReq.status === 'error' && (
        <p className="report__error" role="alert">
          Rapor alınamadı: {reportReq.error}
        </p>
      )}
      {reportReq.data && (
        <div className={hazir ? undefined : 'report__doc-wrap--stale'} aria-busy={!hazir}>
          <CountryReportDocument report={reportReq.data} countryName="Türk dizileri — dünya geneli" />
        </div>
      )}
    </div>
  )
}
