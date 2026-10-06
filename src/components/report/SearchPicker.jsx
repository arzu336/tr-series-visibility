import { useMemo, useState } from 'react'
import Flag from '../Flag.jsx'

/**
 * Yazarak aranan seçici (Raporlar menüsü: ülke ve dizi). Tarayıcının kendi <select> açılır listesi koyu temayı
 * almıyordu (beyaz zemin üzerinde beyaz yazı); bu bileşen her iki seçimde aynı, okunur görünümü verir.
 * `items`: [{ id, label, iso2? }] — iso2 varsa bayrak gösterilir.
 */
export default function SearchPicker({ id, label, placeholder, items, value, onSelect, max = Infinity }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = items.find((i) => i.id === value) ?? null
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr')
    const list = q ? items.filter((i) => i.label.toLocaleLowerCase('tr').includes(q)) : items
    return list.slice(0, max)
  }, [query, items, max])

  const choose = (item) => {
    onSelect(item.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="reports__picker">
      <label htmlFor={id}>{label}</label>
      <div className="reports__picker-box">
        {selected && !query && (
          <span className="reports__picker-current" aria-hidden="true">
            {selected.iso2 && <Flag iso2={selected.iso2} />} {selected.label}
          </span>
        )}
        <input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={`${id}-liste`}
          aria-autocomplete="list"
          placeholder={selected ? '' : placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault()
              choose(matches[0])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          autoComplete="off"
        />
        {open && matches.length > 0 && (
          <ul id={`${id}-liste`} className="reports__matches" role="listbox" aria-label={`${label} seçenekleri`}>
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  {item.iso2 && <Flag iso2={item.iso2} />} {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
