import { useState } from 'react'
import { changePassword } from '../lib/api.js'

export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)

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
      <form className="login__card modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h1>Şifremi Değiştir</h1>
        <input
          type="password"
          placeholder="Mevcut şifre"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="Yeni şifre (en az 8 karakter)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Yeni şifre (tekrar)"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {notice && <p className="login__notice">{notice}</p>}
        {error && <p className="login__error">{error}</p>}
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
