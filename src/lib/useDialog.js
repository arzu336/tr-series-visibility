import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modal erişilebilirliği: Escape kapatır, Tab odak kutunun içinde döner (focus trap), açılışta
// ilk alan odaklanır, kapanışta odak açan öğeye geri verilir. Bileşen `ref`'i diyalog kutusuna
// verir ve role="dialog" aria-modal="true" aria-labelledby ekler.
export function useDialog(ref, onClose) {
  const onceOdak = useRef(null)

  useEffect(() => {
    const kutu = ref.current
    if (!kutu) return undefined
    onceOdak.current = document.activeElement
    const ilk = kutu.querySelector(FOCUSABLE)
    ilk?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return
      const odaklanabilir = Array.from(kutu.querySelectorAll(FOCUSABLE))
      if (odaklanabilir.length === 0) return
      const bas = odaklanabilir[0]
      const son = odaklanabilir[odaklanabilir.length - 1]
      if (e.shiftKey && document.activeElement === bas) {
        e.preventDefault()
        son.focus()
      } else if (!e.shiftKey && document.activeElement === son) {
        e.preventDefault()
        bas.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      onceOdak.current?.focus?.()
    }
  }, [ref, onClose])
}

/** Enter/Space ile tıklama davranışı — role="button" verilen div/li gibi öğeler için. */
export function onEnterOrSpace(handler) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler(e)
    }
  }
}
