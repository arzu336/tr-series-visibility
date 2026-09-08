import { useEffect, useRef, useState } from 'react'
import CulturalImpactTab from './CulturalImpactTab.jsx'
import TourismImpactTab from './TourismImpactTab.jsx'
import ExportImpactTab from './ExportImpactTab.jsx'
import ImpactStats from './ImpactStats.jsx'

const TABS = [
  { key: 'cultural', label: '🏛️ Kültürel Etki & Kamu Diplomasisi' },
  { key: 'tourism', label: '✈️ Turizm & Destinasyon Etkisi' },
  { key: 'export', label: '📈 İhracat & Ticari Etki' },
]

// Yazdırma modunda sekme başlıklarının önündeki emoji atılır — basılı raporda süs değil,
// bölüm başlığı olarak okunmalı.
const PRINT_TITLES = {
  cultural: 'Kültürel Etki ve Kamu Diplomasisi',
  tourism: 'Turizm ve Destinasyon Etkisi',
  export: 'İhracat ve Ticari Etki',
}

// Sekmeler mount olduktan sonra kendi verilerini çeker; hepsi yüklenmeden yazdırmak yarım bir
// PDF üretir. Yükleme göstergeleri (.status) kaybolana kadar beklenir, ama bir uç servis
// takılırsa kullanıcı sonsuza kadar bekletilmez.
const PRINT_READY_TIMEOUT_MS = 20000
const PRINT_POLL_MS = 300

// Eski monolitik ImpactReport.jsx'in (tek /api/impact çağrısı, tüm bölümler birden yüklenirdi)
// yerine geçti — her sekme SADECE kendi ihtiyacı olan uca gider (/api/impact/cultural|tourism|
// export), sekmeler arası geçişte gereksiz veri çekilmez. /api/impact eski tüketiciler için
// aynen duruyor (bkz. server/impact.js), burası artık onu kullanmıyor.
export default function ImpactAnalysisTabs({ onSelectCountry }) {
  const [tab, setTab] = useState('cultural')
  // Denetim bulgusu B-22: "PDF Olarak Yazdır" doğrudan window.print() çağırıyordu, ama sekmeler
  // koşullu mount edildiği için (aşağıdaki render) çıktıda YALNIZCA o an açık olan sekme yer
  // alıyordu — README'nin "tüm rapor basılır" ifadesinin aksine. Artık yazdırmadan önce üç sekme
  // de mount edilip verileri beklenir, sonra basılır ve normale dönülür.
  const [printMode, setPrintMode] = useState('off') // off | hazirlaniyor
  const printAreaRef = useRef(null)

  useEffect(() => {
    if (printMode !== 'hazirlaniyor') return
    let cancelled = false
    let timer = null
    const basladi = Date.now()

    const bittiMi = () => {
      // Her sekme yüklenirken .status sınıflı bir kutu gösterir; hiçbiri kalmadıysa veri hazırdır.
      const bekleyen = printAreaRef.current?.querySelectorAll('.status')?.length ?? 0
      return bekleyen === 0 || Date.now() - basladi > PRINT_READY_TIMEOUT_MS
    }

    const dene = () => {
      if (cancelled) return
      if (!bittiMi()) {
        timer = setTimeout(dene, PRINT_POLL_MS)
        return
      }
      // Tarayıcı yazdırma diyalogu kapanınca normal görünüme dönülür. onafterprint bazı
      // tarayıcılarda print() dönüşünden sonra tetiklendiği için ikisi birden kullanılıyor;
      // setPrintMode('off') iki kez çağrılsa da zararsız.
      const geriDon = () => setPrintMode('off')
      window.addEventListener('afterprint', geriDon, { once: true })
      window.print()
      geriDon()
    }

    timer = setTimeout(dene, 200)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [printMode])

  const yazdiriliyor = printMode === 'hazirlaniyor'

  return (
    <div className={`dashboard${yazdiriliyor ? ' dashboard--printing' : ''}`} ref={printAreaRef}>
      <div className="dashboard__header-row">
        <h2>Ekonomik, Kültürel ve İhracat Etkisi</h2>
        <div className="dashboard__export-actions">
          <button
            className="dashboard__export-btn dashboard__export-btn--ghost"
            onClick={() => setPrintMode('hazirlaniyor')}
            disabled={yazdiriliyor}
          >
            {yazdiriliyor ? 'Rapor hazırlanıyor…' : '🖨 PDF Olarak Yazdır'}
          </button>
        </div>
      </div>

      {/* Yalnızca baskıda görünür: çıktının hangi rapor ve hangi tarih olduğu belli olsun. */}
      <div className="dashboard__print-header">
        <h1>Türk Dizileri — Ekonomik, Kültürel ve İhracat Etkisi Raporu</h1>
        <p>
          T.C. Cumhurbaşkanlığı İletişim Başkanlığı · Kültürel Görünürlük Platformu ·{' '}
          {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
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
