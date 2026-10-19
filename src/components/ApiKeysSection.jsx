import { useCallback, useEffect, useState } from 'react'
import { fetchApiKeys, createApiKey, revokeApiKey, deleteApiKey } from '../lib/api.js'

// API anahtarları (Yönetim): oluştur (düz metin bir kez gösterilir), listele, iptal et, sil.

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function ApiKeysSection() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchApiKeys()
      .then((res) => {
        setItems(res.items || [])
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

  const handleCreate = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await createApiKey(name.trim())
      setCreated(res)
      setName('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn, id, question) => {
    if (question && !window.confirm(question)) return
    setBusy(true)
    try {
      await fn(id)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dashboard__section" id="api-anahtarlari">
      <h3 className="dashboard__section-title">API anahtarları</h3>
      <p className="dashboard__hint">
        Arayüz dışından (başka sistemler, rapor otomasyonu) yalnızca okuma erişimi. Anahtar bir kez gösterilir;
        veritabanında özeti saklanır. İstekte <code>X-API-Key</code> başlığıyla gönderilir.
      </p>
      <form className="api-keys__form" onSubmit={handleCreate}>
        <input
          className="search-input"
          placeholder="Anahtar adı (ör. Kurum içi rapor sistemi)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
        />
        <button type="submit" className="dashboard__link-btn" disabled={busy || name.trim().length < 2}>
          Anahtar oluştur
        </button>
      </form>
      {error && <p className="login__error">{error}</p>}
      {created && (
        <div className="reset-password-banner">
          <strong>{created.name}</strong> için anahtar oluşturuldu: <code>{created.key}</code>
          <br />
          Bu anahtar bir daha gösterilmeyecek; güvenli bir kanaldan iletin ve kullanan sistemin ayarına yazın.{' '}
          <button type="button" className="dashboard__link-btn" onClick={() => setCreated(null)}>
            Kapat
          </button>
        </div>
      )}
      {status === 'loading' ? (
        <p className="dashboard__empty">Yükleniyor…</p>
      ) : items.length === 0 ? (
        <p className="dashboard__empty">Henüz anahtar yok.</p>
      ) : (
        <table className="dashboard__table">
          <thead>
            <tr>
              <th>Ad</th>
              <th>Önek</th>
              <th>Oluşturma</th>
              <th>Son kullanım</th>
              <th>Durum</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id} className={k.revokedAt ? 'dashboard__row--uncertain' : undefined}>
                <td>{k.name}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                <td>{fmt(k.createdAt)}</td>
                <td>{fmt(k.lastUsedAt)}</td>
                <td>{k.revokedAt ? `İptal (${fmt(k.revokedAt)})` : 'Etkin'}</td>
                <td>
                  {!k.revokedAt && (
                    <button
                      type="button"
                      className="dashboard__link-btn"
                      disabled={busy}
                      onClick={() =>
                        act(
                          revokeApiKey,
                          k.id,
                          `${k.name} anahtarı iptal edilsin mi? Kullanan sistem anında erişimini kaybeder.`
                        )
                      }
                    >
                      İptal et
                    </button>
                  )}{' '}
                  <button
                    type="button"
                    className="dashboard__link-btn"
                    disabled={busy}
                    onClick={() => act(deleteApiKey, k.id, `${k.name} kaydı kalıcı olarak silinsin mi?`)}
                  >
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
