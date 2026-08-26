import { useState } from 'react'
import CulturalImpactTab from './CulturalImpactTab.jsx'
import TourismImpactTab from './TourismImpactTab.jsx'
import ExportImpactTab from './ExportImpactTab.jsx'
import ImpactStats from './ImpactStats.jsx'

const TABS = [
  { key: 'cultural', label: '🏛️ Kültürel Etki & Kamu Diplomasisi' },
  { key: 'tourism', label: '✈️ Turizm & Destinasyon Etkisi' },
  { key: 'export', label: '📈 İhracat & Ticari Etki' },
]

// Eski monolitik ImpactReport.jsx'in (tek /api/impact çağrısı, tüm bölümler birden yüklenirdi)
// yerine geçti — her sekme SADECE kendi ihtiyacı olan uca gider (/api/impact/cultural|tourism|
// export), sekmeler arası geçişte gereksiz veri çekilmez. /api/impact eski tüketiciler için
// aynen duruyor (bkz. server/impact.js), burası artık onu kullanmıyor.
export default function ImpactAnalysisTabs({ onSelectCountry }) {
  const [tab, setTab] = useState('cultural')

  return (
    <div className="dashboard">
      <div className="dashboard__header-row">
        <h2>Ekonomik, Kültürel ve İhracat Etkisi</h2>
        <div className="dashboard__export-actions">
          <button className="dashboard__export-btn dashboard__export-btn--ghost" onClick={() => window.print()}>
            🖨 PDF Olarak Yazdır
          </button>
        </div>
      </div>

      <ImpactStats />

      <nav className="app__nav dashboard__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'cultural' && <CulturalImpactTab />}
      {tab === 'tourism' && <TourismImpactTab />}
      {tab === 'export' && <ExportImpactTab onSelectCountry={onSelectCountry} />}
    </div>
  )
}
