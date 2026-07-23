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

// Klasik "kutu kutu" checkbox duvarı yerine: seçilenler chip olarak üstte,
// arama kutusuna yazınca eşleşen kalan destinasyonlar açılır listede seçilir.
function DestinationTagPicker({ taxonomy, draft, onToggle }) {
  const [query, setQuery] = useState('')
  const selected = taxonomy.filter((d) => draft.includes(d.id))
  const q = query.trim().toLocaleLowerCase('tr')
  const suggestions = taxonomy
    .filter((d) => !draft.includes(d.id))
    .filter((d) => !q || d.name.toLocaleLowerCase('tr').includes(q))
    .slice(0, 8)

  return (
    <div className="tag-picker">
      <div className="tag-picker__chips">
        {selected.length === 0 && <span className="tag-picker__empty">Henüz destinasyon seçilmedi</span>}
        {selected.map((d) => (
          <span key={d.id} className="tag-picker__chip">
            {d.name}
            <button
              type="button"
              className="tag-picker__chip-remove"
              onClick={() => onToggle(d.id)}
              aria-label={`${d.name} etiketini kaldır`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="tag-picker__search-wrap">
        <input
          className="tag-picker__search"
          type="text"
          placeholder="Destinasyon ara ve eklemek için seçin..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <ul className="tag-picker__suggestions">
            {suggestions.length > 0 ? (
              suggestions.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onToggle(d.id)
                      setQuery('')
                    }}
                  >
                    {d.name}
                  </button>
                </li>
              ))
            ) : (
              <li className="tag-picker__no-match">Eşleşme yok</li>
            )}
          </ul>
        )}
      </div>
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
  const [search, setSearch] = useState('')

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

  const q = search.trim().toLocaleLowerCase('tr')
  const matchesQuery = (item) => !q || item.name.toLocaleLowerCase('tr').includes(q)
  const untagged = items.filter((i) => i.isUntagged && matchesQuery(i))
  const tagged = items.filter((i) => !i.isUntagged && matchesQuery(i))
  const destName = (id) => taxonomy.find((d) => d.id === id)?.name || id

  return (
    <>
      <div className="dashboard__summary">
        <span className="dashboard__summary-item dashboard__summary-item--warn">
          {items.filter((i) => i.isUntagged).length} dizi hiç destinasyon içermiyor
        </span>
        <span className="dashboard__summary-item dashboard__summary-item--ok">
          {items.filter((i) => !i.isUntagged).length} dizi en az bir destinasyon içeriyor
        </span>
        <input
          className="search-input"
          type="text"
          placeholder="Dizi ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
                    <DestinationTagPicker
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
                    <DestinationTagPicker
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
  const [tab, setTab] = useState('themes') // themes | destinations
  const [items, setItems] = useState([])
  const [taxonomy, setTaxonomy] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')

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

  const q = search.trim().toLocaleLowerCase('tr')
  const matchesQuery = (item) => !q || item.name.toLocaleLowerCase('tr').includes(q)
  const needsReview =
    status === 'ready' ? items.filter((i) => i.effectiveConfidence < CONFIDENCE_THRESHOLD && matchesQuery(i)) : []
  const approved =
    status === 'ready' ? items.filter((i) => i.effectiveConfidence >= CONFIDENCE_THRESHOLD && matchesQuery(i)) : []

  return (
    <div className="dashboard">
      <h2>Analist Paneli</h2>

      <nav className="app__nav dashboard__tabs">
        <button
          className={tab === 'themes' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
          onClick={() => setTab('themes')}
        >
          Tema Sınıflandırma
        </button>
        <button
          className={tab === 'destinations' ? 'app__nav-btn app__nav-btn--active' : 'app__nav-btn'}
          onClick={() => setTab('destinations')}
        >
          Destinasyon Etiketleme
        </button>
      </nav>

      {tab === 'themes' && (
        <>
          {status === 'loading' && <div className="status">Yükleniyor…</div>}
          {status === 'error' && <div className="status status--error">Hata: {error}</div>}
          {status === 'ready' && (
            <>
              <div className="dashboard__summary">
                <span className="dashboard__summary-item dashboard__summary-item--warn">
                  {items.filter((i) => i.effectiveConfidence < CONFIDENCE_THRESHOLD).length} dizi incelemeyi bekliyor
                </span>
                <span className="dashboard__summary-item dashboard__summary-item--ok">
                  {items.filter((i) => i.effectiveConfidence >= CONFIDENCE_THRESHOLD).length} dizi onaylı
                </span>
                <input
                  className="search-input"
                  type="text"
                  placeholder="Dizi ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <section className="dashboard__section">
                <h3 className="dashboard__section-title">İncelenmesi Gerekenler</h3>
                <p className="dashboard__hint">
                  Güven skoru {CONFIDENCE_THRESHOLD}'in altındaki kayıtlar — LLM net bir eşleşme
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
                        <td>{item.humanOverride ? 'İnsan' : 'LLM'}</td>
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
            </>
          )}
        </>
      )}

      {tab === 'destinations' && <DestinationSection />}
    </div>
  )
}
