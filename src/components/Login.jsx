import { useState } from 'react'
import { login, register } from '../lib/api.js'

export default function Login({ onSuccess }) {
  const [mode, setMode] = useState('login') // login | register
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const switchMode = (next) => {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      onSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      await register({ name, email, role, password })
      setNotice('Hesabınız oluşturuldu. Yönetici onayından sonra giriş yapabilirsiniz.')
      setMode('login')
      setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const isLogin = mode === 'login'
  const canSubmit = isLogin ? email && password : name && email && password

  return (
    <div className="login">
      <form className="login__card" onSubmit={isLogin ? handleLogin : handleRegister}>
        <h1>Kültürel Görünürlük Platformu</h1>
        <p className="login__hint">
          {isLogin ? 'Devam etmek için giriş yapın.' : 'Kayıt olun — yönetici onayından sonra giriş yapabilirsiniz.'}
        </p>

        {!isLogin && (
          <>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" autoFocus />
            <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Kurumdaki göreviniz" />
          </>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-posta"
          autoFocus={isLogin}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Şifre"
        />

        {notice && <p className="login__notice">{notice}</p>}
        {error && <p className="login__error">{error}</p>}

        <button type="submit" disabled={submitting || !canSubmit}>
          {submitting ? (isLogin ? 'Giriş yapılıyor…' : 'Kayıt oluşturuluyor…') : isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
        </button>

        <button type="button" className="login__toggle" onClick={() => switchMode(isLogin ? 'register' : 'login')}>
          {isLogin ? 'Hesabınız yok mu? Kayıt olun' : 'Zaten hesabınız var mı? Giriş yapın'}
        </button>
      </form>
    </div>
  )
}
