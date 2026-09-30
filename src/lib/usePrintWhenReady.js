import { useCallback, useEffect, useRef, useState } from 'react'

// "PDF olarak yazdır" akışı: düğme baskı modunu açar, bileşen baskı düzenine geçer (ör. tüm
// sekmeleri birden mount eder), bu hook yazdırma alanında bekleyen yükleme göstergesi
// (pendingSelector) kalmayıncaya — ya da zaman aşımına — kadar yoklar, sonra window.print()
// çağırır ve afterprint ile baskı modunu kapatır. ImpactAnalysisTabs'teki kalıp buraya taşındı.
export function usePrintWhenReady({ readyTimeoutMs = 20000, pollMs = 300, pendingSelector = '.status' } = {}) {
  const [printMode, setPrintMode] = useState('off')
  const printAreaRef = useRef(null)

  useEffect(() => {
    if (printMode !== 'hazirlaniyor') return undefined
    let cancelled = false
    let timer = null
    const basladi = Date.now()

    const bittiMi = () => {
      const bekleyen = printAreaRef.current?.querySelectorAll(pendingSelector)?.length ?? 0
      return bekleyen === 0 || Date.now() - basladi > readyTimeoutMs
    }

    const dene = () => {
      if (cancelled) return
      if (!bittiMi()) {
        timer = setTimeout(dene, pollMs)
        return
      }
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
  }, [printMode, readyTimeoutMs, pollMs, pendingSelector])

  const requestPrint = useCallback(() => setPrintMode('hazirlaniyor'), [])

  return { printAreaRef, printing: printMode === 'hazirlaniyor', requestPrint }
}
