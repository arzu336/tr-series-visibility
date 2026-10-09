import { usePrintWhenReady } from '../../lib/usePrintWhenReady.js'
import SeriesPage from '../SeriesPage.jsx'

// Dizi raporu görünümü (2026-10-07: dizi sayfasıyla birleşti). Gövde SeriesPage'te: tanıtım kartı + rapor belgesi +
// canlı bölümler. Burada yalnızca PDF akışı: usePrintWhenReady yükleme göstergesi (.report__loading) kalmayınca
// window.print() çağırır.
export default function SeriesReportView({ seriesId, allCountries, onBack, backLabel, actions = {}, isAdmin = false }) {
  const { printAreaRef, printing, requestPrint } = usePrintWhenReady({ pendingSelector: '.report__loading' })
  return (
    <div className={`report${printing ? ' dashboard--printing report--printing' : ''}`} ref={printAreaRef}>
      <SeriesPage
        key={seriesId}
        seriesId={seriesId}
        allCountries={allCountries}
        onBack={onBack}
        backLabel={backLabel}
        onShowOnMap={actions.onShowOnMap}
        onSelectActor={actions.onSelectActor}
        onShowInterestOnMap={actions.onShowInterestOnMap}
        onPrint={requestPrint}
        printing={printing}
        isAdmin={isAdmin}
      />
    </div>
  )
}
