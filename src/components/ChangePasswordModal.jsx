import { useRef, useState } from 'react'
import { changePassword } from '../lib/api.js'
import { useDialog } from '../lib/useDialog.js'

export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const kutuRef = useRef(null)
  useDialog(kutuRef, onClose)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor')
      return
    }
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      setNotice('Şifreniz güncellendi.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        ref={kutuRef}
        className="login__card modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sifre-degistir-baslik"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h1 id="sifre-degistir-baslik">Şifremi Değiştir</h1>
        <label className="sr-only" htmlFor="sifre-mevcut">
          Mevcut şifre
        </label>
        <input
          id="sifre-mevcut"
          type="password"
          placeholder="Mevcut şifre"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <label className="sr-only" htmlFor="sifre-yeni">
          Yeni şifre (en az 8 karakter)
        </label>
        <input
          id="sifre-yeni"
          type="password"
          placeholder="Yeni şifre (en az 8 karakter)"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <label className="sr-only" htmlFor="sifre-yeni-tekrar">
          Yeni şifre (tekrar)
        </label>
        <input
          id="sifre-yeni-tekrar"
          type="password"
          placeholder="Yeni şifre (tekrar)"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {notice && (
          <p className="login__notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || !currentPassword || !newPassword}>
          {submitting ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        <button type="button" className="login__toggle" onClick={onClose}>
          Kapat
        </button>
      </form>
    </div>
  )
}
