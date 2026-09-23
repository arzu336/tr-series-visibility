import { useEffect, useState } from 'react'

// localStorage'a yazılan kullanıcı tercihleri (harita görünümü, metrik, çekmece durumları):
// aynı "ilk değeri storage'dan oku + her değişimde geri yaz" kalıbı App.jsx'te dört kez elle
// yazılmıştı. `parse`/`serialize` ile tip dönüşümü ('1'/'0' ↔ boolean gibi) çağırana bırakılır;
// `fallback` fonksiyon olabilir (ör. ekran genişliğine göre varsayılan).
export function usePersistedState(key, fallback, { parse = (s) => s, serialize = (v) => String(v) } = {}) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return typeof fallback === 'function' ? fallback() : fallback
    try {
      const stored = window.localStorage.getItem(key)
      if (stored != null) return parse(stored)
    } catch {
      /* özel mod / kapalı depolama — varsayılana düş */
    }
    return typeof fallback === 'function' ? fallback() : fallback
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, serialize(value))
    } catch {
      /* yazılamazsa tercih bu oturumla sınırlı kalır */
    }
  }, [key, value, serialize])

  return [value, setValue]
}

export const boolStorage = { parse: (s) => s === '1', serialize: (v) => (v ? '1' : '0') }
