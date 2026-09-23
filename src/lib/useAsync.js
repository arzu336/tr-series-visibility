import { useEffect, useState } from 'react'

// "let cancelled = false … return () => { cancelled = true }" kalıbı 12 bileşende elle
// kopyalanmıştı. Tek hook: bağımlılıklar değişince yeniden çeker, geç gelen eski yanıtı
// (yarış) yok sayar, unmount'ta sızıntı bırakmaz. Bileşen kendi alan durumunu (ör. 'unavailable')
// dönen data'dan türetir; hook yalnızca idle | loading | ready | error bilir.
//
// `enabled: false` → hiç istek atmaz, status 'idle' (koşullu çekim için; hook'lar koşullu
// çağrılamaz, bu bayrak onun yerine geçer). `keepPrevious: true` → yeniden çekerken eski data
// korunur (grafik boşalıp yeniden dolmasın, soluklaştırılarak beklesin).
export function useAsync(fn, deps, { enabled = true, keepPrevious = false } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null })

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null })
      return undefined
    }
    let cancelled = false
    setState((prev) => ({ status: 'loading', data: keepPrevious ? prev.data : null, error: null }))
    Promise.resolve()
      .then(fn)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err?.message || String(err) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  return state
}
