import { useState } from 'react'
import { usePrintWhenReady } from '../lib/usePrintWhenReady.js'
import CulturalImpactTab from './CulturalImpactTab.jsx'
import TourismImpactTab from './TourismImpactTab.jsx'
import ExportImpactTab from './ExportImpactTab.jsx'
import ImpactStats from './ImpactStats.jsx'
import CountryConvergencePanel from './CountryConvergencePanel.jsx'
import { IconLandmark, IconPlane, IconTrend, IconPrint } from './Icons.jsx'

const TABS = [
  { key: 'cultural', label: 'Kültürel Etki & Kamu Diplomasisi', Icon: IconLandmark },
  { key: 'tourism', label: 'Turizm & Destinasyon Etkisi', Icon: IconPlane },
  { key: 'export', label: 'İhracat & Ticari Etki', Icon: IconTrend },
]

const PRINT_TITLES = {
  cultural: 'Kültürel Etki ve Kamu Diplomasisi',
  tourism: 'Turizm ve Destinasyon Etkisi',
  export: 'İhracat ve Ticari Etki',
}

const PRINT_READY_TIMEOUT_MS = 20000
const PRINT_POLL_MS = 300

export default function ImpactAnalysisTabs({ onSelectCountry }) {
  const [tab, setTab] = useState('cultural')
  const {
    printAreaRef,
    printing: yazdiriliyor,
    requestPrint,
  } = usePrintWhenReady({
    readyTimeoutMs: PRINT_READY_TIMEOUT_MS,
    pollMs: PRINT_POLL_MS,
  })

  return (
    <div className={`dashboard${yazdiriliyor ? ' dashboard--printing' : ''}`} ref={printAreaRef}>
      <div className="dashboard__header-row">
        <h2>Ekonomik, Kültürel ve İhracat Etkisi</h2>
        <div className="dashboard__export-actions">
          <button
            className="dashboard__export-btn dashboard__export-btn--ghost"
            onClick={requestPrint}
            disabled={yazdiriliyor}
          >
            {yazdiriliyor ? (
              'Rapor hazırlanıyor…'
            ) : (
              <>
                <IconPrint size={15} inline />
                PDF olarak yazdır
              </>
            )}
          </button>
        </div>
      </div>

      {/* Yalnızca baskıda görünür: çıktının hangi rapor ve hangi tarih olduğu belli olsun. */}
      <div className="dashboard__print-header">
        <h1>Türk Dizileri — Ekonomik, Kültürel ve İhracat Etkisi Raporu</h1>
        <p>
          T.C. Cumhurbaşkanlığı İletişim Başkanlığı · Türk Dizileri Küresel Görünürlük Platformu ·{' '}
          {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <ImpactStats />

      {/* Sekmelerin ÜSTÜNDE: üç sekmenin verisini tek bir ülke için birleştiren görünüm.
          Sekme içinde değil, çünkü üçünü birden kesiyor. Yazdırma modunda gizlenir — basılı
          rapor tüm ülkeleri kapsar, tek ülkelik bir filtre orada yanıltıcı olurdu. */}
      {!yazdiriliyor && <CountryConvergencePanel />}

      <nav className="app__nav dashboard__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
            onClick={() => setTab(t.key)}
          >
            <t.Icon size={15} inline />
            {t.label}
          </button>
        ))}
      </nav>

      {/* Yazdırma modunda ÜÇ sekme birden, başlıklarıyla alt alta; normalde yalnızca seçili olan. */}
      {yazdiriliyor ? (
        <>
          <div className="dashboard__print-group">
            <h2 className="dashboard__print-group-title">{PRINT_TITLES.cultural}</h2>
            <CulturalImpactTab />
          </div>
          <div className="dashboard__print-group">
            <h2 className="dashboard__print-group-title">{PRINT_TITLES.tourism}</h2>
            <TourismImpactTab />
          </div>
          <div className="dashboard__print-group">
            <h2 className="dashboard__print-group-title">{PRINT_TITLES.export}</h2>
            <ExportImpactTab onSelectCountry={onSelectCountry} />
          </div>
        </>
      ) : (
        <>
          {tab === 'cultural' && <CulturalImpactTab />}
          {tab === 'tourism' && <TourismImpactTab />}
          {tab === 'export' && <ExportImpactTab onSelectCountry={onSelectCountry} />}
        </>
      )}
    </div>
  )
}
