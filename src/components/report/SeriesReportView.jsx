import { fetchSeriesReport } from '../../lib/api.js'
import { useAsync } from '../../lib/useAsync.js'
import { usePrintWhenReady } from '../../lib/usePrintWhenReady.js'
import CountryReportDocument from './CountryReportDocument.jsx'
import { IconPrint } from '../Icons.jsx'

// Dizi raporu görünümü: ülke brifingiyle aynı belge bileşeni (özet → başlıklar → ek) ve aynı PDF akışı.
export default function SeriesReportView({ seriesId }) {
  const reportReq = useAsync(() => fetchSeriesReport(seriesId), [seriesId], {
    enabled: seriesId != null,
    keepPrevious: true,
  })
  const { printAreaRef, printing, requestPrint } = usePrintWhenReady({ pendingSelector: '.report__loading' })
  const hazir = reportReq.status === 'ready' && reportReq.data?.seriesId === seriesId

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
          Dizi raporu hazırlanıyor…
        </p>
      )}
      {reportReq.status === 'error' && (
        <p className="report__error" role="alert">
          Rapor alınamadı: {reportReq.error}
        </p>
      )}
      {reportReq.data && (
        <div className={hazir ? undefined : 'report__doc-wrap--stale'} aria-busy={!hazir}>
          <CountryReportDocument report={reportReq.data} countryName={reportReq.data.seriesName} />
        </div>
      )}
    </div>
  )
}
