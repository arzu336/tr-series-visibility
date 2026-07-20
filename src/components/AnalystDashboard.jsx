import { useCallback, useEffect, useState } from 'react'
import {
  fetchTaxonomy,
  fetchThemes,
  submitThemeOverride,
  fetchDestinationTaxonomy,
  fetchDestinations,
  submitDestinationOverride,
} from '../lib/api.js'

const CONFIDENCE_THRESHOLD = 70
const OVERVIEW_PREVIEW_LENGTH = 90

function OverviewCell({ overview }) {
  const [expanded, setExpanded] = useState(false)
  const text = overview || '—'
  const isLong = text.length > OVERVIEW_PREVIEW_LENGTH
  const shown = expanded || !isLong ? text : `${text.slice(0, OVERVIEW_PREVIEW_LENGTH)}…`
  return (
    <td
      className="dashboard__overview"
      onClick={() => isLong && setExpanded((v) => !v)}
      style={isLong ? { cursor: 'pointer' } : undefined}
    >
      {shown}
      {isLong && <span className="dashboard__expand-hint"> {expanded ? '(kısalt)' : '(devamını gör)'}</span>}
    </td>
  )
}

function EditControls({ item, taxonomy, draft, onDraftChange, onApprove, saving }) {
  return (
    <>
      <select value={draft ?? item.effectiveTheme} onChange={(e) => onDraftChange(e.target.value)}>
        {taxonomy.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button disabled={saving} onClick={onApprove}>
        Onayla
      </button>
    </>
  )
}

function DestinationCheckboxes({ taxonomy, draft, onToggle }) {
  return (
    <div className="dashboard__checkbox-list">
      {taxonomy.map((d) => (
        <label key={d.id} className="dashboard__checkbox">
          <input
            type="checkbox"
            checked={draft.includes(d.id)}
            onChange={() => onToggle(d.id)}
          />
          {d.name}
        </label>
      ))}
    </div>
  )
}

function DestinationSection() {
  const [items, setItems] = useState([])
  const [taxonomy, setTaxonomy] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const load = useCallback(() => {
    setStatus('loading')
    Promise.all([fetchDestinations(), fetchDestinationTaxonomy()])
      .then(([destRes, taxonomyRes]) => {
        setItems(destRes.items)
        setTaxonomy(taxonomyRes.destinations)
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

  const toggleDraft = (item, destId) => {
    setDrafts((d) => {
      const current = d[item.id] ?? item.effectiveDestinations
      const next = current.includes(destId)
        ? current.filter((id) => id !== destId)
        : [...current, destId]
      return { ...d, [item.id]: next }
    })
  }

  const handleSave = async (item) => {
    const chosen = drafts[item.id] ?? item.effectiveDestinations
    setSavingId(item.id)
    try {
      await submitDestinationOverride(item.id, chosen, 'analist')
      setEditingId(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  const untagged = items.filter((i) => i.isUntagged)
  const tagged = items.filter((i) => !i.isUntagged)
  const destName = (id) => taxonomy.find((d) => d.id === id)?.name || id

  return (
    <>
      <div className="dashboard__summary">
        <span className="dashboard__summary-item dashboard__summary-item--warn">
          {untagged.length} dizi hiç destinasyon içermiyor
        </span>
        <span className="dashboard__summary-item dashboard__summary-item--ok">
          {tagged.length} dizi en az bir destinasyon içeriyor
        </span>
      </div>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Etiketlenmemiş Diziler</h3>
        <p className="dashboard__hint">
          Sinopsis metninde bilinen bir destinasyon adı geçmedi. Diziyi biliyorsanız hangi
          destinasyonu öne çıkardığını işaretleyip kaydedin — sinopsis eşleşmesi yoksa bu alan
          boş kalır, bir çekim lokasyonu iddiası değildir.
        </p>
        {untagged.length === 0 ? (
          <p className="dashboard__empty">Şu anda etiketlenmemiş dizi yok.</p>
        ) : (
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Dizi</th>
                <th>Özet</th>
                <th>Destinasyonlar</th>
                <th>Kaydet</th>
              </tr>
            </thead>
            <tbody>
              {untagged.map((item) => (
                <tr key={item.id} className="dashboard__row--uncertain">
                  <td>{item.name}</td>
                  <OverviewCell overview={item.overview} />
                  <td>
                    <DestinationCheckboxes
                      taxonomy={taxonomy}
                      draft={drafts[item.id] ?? item.effectiveDestinations}
                      onToggle={(destId) => toggleDraft(item, destId)}
                    />
                  </td>
                  <td>
                    <button disabled={savingId === item.id} onClick={() => handleSave(item)}>
                      Kaydet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Etiketlenmiş Diziler</h3>
        <table className="dashboard__table dashboard__table--compact">
          <thead>
            <tr>
              <th>Dizi</th>
              <th>Destinasyonlar</th>
              <th>Kaynak</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tagged.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  {editingId === item.id ? (
                    <DestinationCheckboxes
                      taxonomy={taxonomy}
                      draft={drafts[item.id] ?? item.effectiveDestinations}
                      onToggle={(destId) => toggleDraft(item, destId)}
                    />
                  ) : (
                    item.effectiveDestinations.map((id) => (
                      <span key={id} className="badge badge--ok">
                        {destName(id)}
                      </span>
                    ))
                  )}
                </td>
                <td>{item.humanTags ? 'İnsan' : 'Sinopsis eşleşmesi'}</td>
                <td>
                  {editingId === item.id ? (
                    <button disabled={savingId === item.id} onClick={() => handleSave(item)}>
                      Kaydet
                    </button>
                  ) : (
                    <button className="dashboard__link-btn" onClick={() => setEditingId(item.id)}>
                      Düzelt
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}

export default function AnalystDashboard() {
  const [items, setItems] = useState([])
  const [taxonomy, setTaxonomy] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const load = useCallback(() => {
    setStatus('loading')
    Promise.all([fetchThemes(), fetchTaxonomy()])
      .then(([themesRes, taxonomyRes]) => {
        setItems(themesRes.items)
        setTaxonomy(taxonomyRes.themes)
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

  const handleApprove = async (item) => {
    const chosen = drafts[item.id] ?? item.effectiveTheme
    setSavingId(item.id)
    try {
      await submitThemeOverride(item.id, chosen, 'analist')
      setEditingId(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  if (status === 'loading') return <div className="dashboard status">Yükleniyor…</div>
  if (status === 'error') return <div className="dashboard status status--error">Hata: {error}</div>

  const needsReview = items.filter((i) => i.effectiveConfidence < CONFIDENCE_THRESHOLD)
  const approved = items.filter((i) => i.effectiveConfidence >= CONFIDENCE_THRESHOLD)

  return (
    <div className="dashboard">
      <h2>Analist Paneli — Tema Sınıflandırma İncelemesi</h2>

      <div className="dashboard__summary">
        <span className="dashboard__summary-item dashboard__summary-item--warn">
          {needsReview.length} dizi incelemeyi bekliyor
        </span>
        <span className="dashboard__summary-item dashboard__summary-item--ok">
          {approved.length} dizi onaylı
        </span>
      </div>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">İncelenmesi Gerekenler</h3>
        <p className="dashboard__hint">
          Güven skoru {CONFIDENCE_THRESHOLD}'in altındaki kayıtlar — kural motoru net bir eşleşme
          bulamadı. Doğru temayı seçip "Onayla" ile kaydedin.
        </p>
        {needsReview.length === 0 ? (
          <p className="dashboard__empty">Şu anda incelenmesi gereken kayıt yok.</p>
        ) : (
          <table className="dashboard__table">
            <thead>
              <tr>
                <th>Dizi</th>
                <th>Özet</th>
                <th>Tema</th>
                <th>Güven</th>
                <th>Düzelt</th>
              </tr>
            </thead>
            <tbody>
              {needsReview.map((item) => (
                <tr key={item.id} className="dashboard__row--uncertain">
                  <td>{item.name}</td>
                  <OverviewCell overview={item.overview} />
                  <td>{item.effectiveTheme}</td>
                  <td>
                    <span className="badge badge--uncertain">{item.effectiveConfidence}</span>
                  </td>
                  <td>
                    <EditControls
                      item={item}
                      taxonomy={taxonomy}
                      draft={drafts[item.id]}
                      onDraftChange={(v) => setDrafts((d) => ({ ...d, [item.id]: v }))}
                      onApprove={() => handleApprove(item)}
                      saving={savingId === item.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard__section">
        <h3 className="dashboard__section-title">Onaylı Sınıflandırmalar</h3>
        <table className="dashboard__table dashboard__table--compact">
          <thead>
            <tr>
              <th>Dizi</th>
              <th>Tema</th>
              <th>Güven</th>
              <th>Kaynak</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {approved.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.effectiveTheme}</td>
                <td>
                  <span className="badge badge--ok">{item.effectiveConfidence}</span>
                </td>
                <td>{item.humanOverride ? 'İnsan' : 'Kural motoru'}</td>
                <td>
                  {editingId === item.id ? (
                    <EditControls
                      item={item}
                      taxonomy={taxonomy}
                      draft={drafts[item.id]}
                      onDraftChange={(v) => setDrafts((d) => ({ ...d, [item.id]: v }))}
                      onApprove={() => handleApprove(item)}
                      saving={savingId === item.id}
                    />
                  ) : (
                    <button className="dashboard__link-btn" onClick={() => setEditingId(item.id)}>
                      Düzelt
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2>Analist Paneli — Destinasyon Etiketleme</h2>
      <DestinationSection />
    </div>
  )
}
