import { useCallback, useEffect, useState } from 'react'
import { fetchAdminUsers, approveUser, rejectUser, toggleAdmin } from '../lib/api.js'

function formatDate(iso) {
  return new Date(iso).toLocaleString('tr-TR')
}

export default function AdminUsersPanel() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [actingId, setActingId] = useState(null)
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    setStatus('loading')
    fetchAdminUsers()
      .then((res) => {
        setItems(res.items)
        setStatus('ready')
      })
      .catch((err) => {
        setError(err.message)
        setStatus('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (fn, id) => {
    setActingId(id)
    try {
      await fn(id)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActingId(null)
    }
  }

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  const q = search.trim().toLocaleLowerCase('tr')
  const matchesQuery = (u) =>
    !q || u.name.toLocaleLowerCase('tr').includes(q) || u.email.toLocaleLowerCase('tr').includes(q)
  const pending = items.filter((u) => u.status === 'pending' && matchesQuery(u))
  const others = items.filter((u) => u.status !== 'pending' && matchesQuery(u))

  return (
    <div className="dashboard">
      <h2>Kullanıcı Yönetimi</h2>

      <div className="dashboard__summary">
        <span className="dashboard__summary-item dashboard__summary-item--warn">
          {items.filter((u) => u.status === 'pending').length} onay bekliyor
        </span>
        <span className="dashboard__summary-item dashboard__summary-item--ok">
          {items.filter((u) => u.status !== 'pending').length} karara bağlandı
        </span>
        <input
          className="search-input"
          type="text"
          placeholder="İsim veya e-posta ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p className="login__error">{error}</p>}

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Onay Bekleyenler</h3>
        {pending.length === 0 ? (
          <p className="dashboard__empty">Onay bekleyen kullanıcı yok.</p>
        ) : (
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>E-posta</th>
                <th>Görev</th>
                <th>Kayıt Tarihi</th>
                <th>Karar</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id} className="dashboard__row--uncertain">
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role || '—'}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>
                    <button disabled={actingId === u.id} onClick={() => act(approveUser, u.id)}>
                      Onayla
                    </button>{' '}
                    <button disabled={actingId === u.id} className="dashboard__link-btn" onClick={() => act(rejectUser, u.id)}>
                      Reddet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Tüm Kullanıcılar</h3>
        {others.length === 0 ? (
          <p className="dashboard__empty">Henüz karara bağlanmış kullanıcı yok.</p>
        ) : (
          <table className="dashboard__table dashboard__table--compact">
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>E-posta</th>
                <th>Görev</th>
                <th>Durum</th>
                <th>Yönetici</th>
              </tr>
            </thead>
            <tbody>
              {others.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role || '—'}</td>
                  <td>
                    <span className={u.status === 'approved' ? 'badge badge--ok' : 'badge badge--uncertain'}>
                      {u.status === 'approved' ? 'onaylı' : 'reddedildi'}
                    </span>
                  </td>
                  <td>
                    {u.status === 'approved' && (
                      <button disabled={actingId === u.id} className="dashboard__link-btn" onClick={() => act(toggleAdmin, u.id)}>
                        {u.isAdmin ? 'Yöneticilikten çıkar' : 'Yönetici yap'}
                      </button>
                    )}
                    {u.isAdmin && <span className="badge badge--ok admin-panel__admin-badge">admin</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
