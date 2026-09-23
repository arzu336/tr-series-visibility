import { useCallback, useEffect, useState } from 'react'

// Analist panelindeki tema ve destinasyon sekmeleri aynı akışı iki kez yazıyordu: listeyi +
// taksonomiyi yükle, satır başına taslak tut, kaydet/geri al, kaydederken satırı kilitle,
// başarıda listeyi sessizce tazele (tablo unmount olmasın), hatayı satır adıyla göster.
// Hook bu akışı tek yerde tutar; sekmeler yalnızca API çağrılarını ve tabloyu verir.
export function useOverrideEditor({ fetchAll, save, revert, saveFailLabel = 'kaydedilemedi', revertFailLabel = 'geri alınamadı' }) {
  const [items, setItems] = useState([])
  const [taxonomy, setTaxonomy] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const reload = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setStatus('loading')
      return fetchAll()
        .then(({ items: yeniItems, taxonomy: yeniTaxonomy }) => {
          setItems(yeniItems)
          setTaxonomy(yeniTaxonomy)
          setStatus('ready')
        })
        .catch((err) => {
          setError(err.message)
          if (!silent) setStatus('error')
        })
    },
    [fetchAll]
  )

  useEffect(() => {
    reload()
  }, [reload])

  const setDraft = useCallback((id, value) => setDrafts((d) => ({ ...d, [id]: value })), [])
  const updateDraft = useCallback((id, fn, fallback) => setDrafts((d) => ({ ...d, [id]: fn(d[id] ?? fallback) })), [])

  const run = async (item, action, failLabel) => {
    setSavingId(item.id)
    setError(null)
    try {
      await action()
      setEditingId(null)
      await reload({ silent: true })
      return true
    } catch (err) {
      setError(`"${item.name}" ${failLabel}: ${err.message}`)
      return false
    } finally {
      setSavingId(null)
    }
  }

  const saveItem = (item, value) => run(item, () => save(item.id, value), saveFailLabel)
  const revertItem = (item) => run(item, () => revert(item.id), revertFailLabel)

  return {
    items,
    taxonomy,
    status,
    error,
    setError,
    drafts,
    setDraft,
    updateDraft,
    savingId,
    editingId,
    setEditingId,
    saveItem,
    revertItem,
    reload,
  }
}
