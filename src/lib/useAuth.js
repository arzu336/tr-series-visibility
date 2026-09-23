import { useCallback, useEffect, useState } from 'react'
import { fetchAuthStatus, setUnauthorizedHandler } from './api.js'

// Oturum durumu: 'checking' → 'in' | 'out'. Sunucudan 401 gelince (api.js'in
// setUnauthorizedHandler kancası) oturum düşürülür ve giriş ekranına bir açıklama taşınır.
export function useAuth() {
  const [authStatus, setAuthStatus] = useState('checking')
  const [user, setUser] = useState(null)
  const [sessionNotice, setSessionNotice] = useState(null)

  const refresh = useCallback(() => {
    fetchAuthStatus()
      .then((d) => {
        setUser(d.user)
        setAuthStatus(d.authenticated ? 'in' : 'out')
        if (d.authenticated) setSessionNotice(null)
      })
      .catch(() => setAuthStatus('out'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      setUser(null)
      setAuthStatus('out')
      setSessionNotice(message)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const signOut = useCallback(() => {
    setUser(null)
    setAuthStatus('out')
  }, [])

  return { authStatus, user, sessionNotice, refresh, signOut }
}
