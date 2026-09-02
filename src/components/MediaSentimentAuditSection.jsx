import { useCallback, useEffect, useState } from 'react'
import { fetchMediaSentimentAudit, submitMediaSentimentOverride, clearMediaSentimentOverride } from '../lib/api.js'
import countryNames from '../data/country-centroids.json'
import { HumanAuditIcon } from './AnalystDashboard.jsx'

const TONE_LABELS = { positive: 'Olumlu', neutral: 'Nötr', negative: 'Olumsuz' }
const TONE_OPTIONS = ['positive', 'neutral', 'negative']

function ToneBadge({ tone }) {
  if (tone === 'positive') return <span className="badge badge--ok">Olumlu</span>
  if (tone === 'negative') return <span className="badge badge--uncertain">Olumsuz</span>
  if (tone === 'yetersiz-veri') return <span className="dashboard__empty">—</span>
  return <span className="badge badge--info">Nötr</span>
}

// Analist Paneli §3 — "Basın & Medya Algısı Denetimi". media_sentiment tablosunun SQL ile
// doğrudan listelenebilmesi için tasarlandığı yorumla uyumlu (bkz. server/db.js). ÖNEMLİ:
// bir satır TEK bir haber değil, bir dizinin bir ülkede TARANMIŞ haber GRUBUDUR (LLM haberleri
// toplu değerlendiriyor, bkz. server/llm.js analyzeMediaSentiment) — bu yüzden "ton düzeltme"
// bu taramanın genel tonunu düzeltir; analistin kararına dayanak olsun diye taranan haber
// başlıkları da satırla birlikte gösterilir.
export default function MediaSentimentAuditSection({ canEdit = true, reviewerName = 'anonim' }) {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [search, setSearch] = useState('')
  const [toneFilter, setToneFilter] = useState('')

  const load = useCallback(() => {
    setStatus('loading')
    fetchMediaSentimentAudit()
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

  // "Tek tıkla değiştirme" — ayrı bir taslak/Kaydet akışı yerine dropdown'un onChange'i
  // doğrudan kaydeder (kullanıcı talebi: "tek tıkla değiştirmesini sağla").
  const handleChangeTone = async (item, sentiment) => {
    if (sentiment === item.effectiveSentiment) return
    setSavingId(item.id)
    try {
      await submitMediaSentimentOverride(item.id, sentiment, reviewerName)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  const handleRevert = async (item) => {
    setSavingId(item.id)
    try {
      await clearMediaSentimentOverride(item.id)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  if (status === 'loading') return <div className="status">Yükleniyor…</div>
  if (status === 'error') return <div className="status status--error">Hata: {error}</div>

  const q = search.trim().toLocaleLowerCase('tr')
  const filtered = items.filter((i) => {
    const matchesQuery = !q || i.seriesName.toLocaleLowerCase('tr').includes(q)
    const matchesTone = !toneFilter || i.effectiveSentiment === toneFilter
    return matchesQuery && matchesTone
  })

  return (
    <>
      <p className="dashboard__hint">
        Her satır bir dizinin bir ülkede taranmış haber grubudur (tek bir haber değil) — LLM haberleri toplu
        değerlendirir, ton düzeltmesi bu taramanın genelini düzeltir.
      </p>
      <div className="dashboard__summary">
        <span className="dashboard__summary-item dashboard__summary-item--ok">{items.length} tarama kaydı</span>
        <input
          className="search-input"
          type="text"
          placeholder="Dizi ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={toneFilter} onChange={(e) => setToneFilter(e.target.value)}>
          <option value="">Tüm tonlar</option>
          {TONE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {TONE_LABELS[t]}
            </option>
          ))}
          <option value="yetersiz-veri">Veri Yok</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="dashboard__empty">Henüz hiçbir dizi/ülke için basın taraması yapılmadı.</p>
      ) : (
        <table className="dashboard__table dashboard__table--compact">
          <thead>
            <tr>
              <th>Dizi</th>
              <th>Ülke</th>
              <th>Taranan Haberler</th>
              <th>Ton</th>
              <th>Kaynak</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className={item.effectiveSentiment === 'negative' ? 'dashboard__row--uncertain' : undefined}>
                <td>{item.seriesName}</td>
                <td>{countryNames[item.countryIso2]?.name || item.countryIso2}</td>
                <td className="dashboard__overview">
                  {item.articles.length === 0 ? (
                    <span className="dashboard__empty">{item.totalNewsCount === 0 ? 'Haber bulunamadı' : '—'}</span>
                  ) : (
                    <ul className="dashboard__article-list">
                      {item.articles.map((a, i) => (
                        <li key={i}>
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noreferrer">
                              {a.title}
                            </a>
                          ) : (
                            a.title
                          )}
                          {a.source && <span className="dashboard__article-source"> — {a.source}</span>}
                        </li>
                      ))}
                      {item.totalNewsCount > item.articles.length && (
                        <li className="dashboard__article-source">+{item.totalNewsCount - item.articles.length} haber daha</li>
                      )}
                    </ul>
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <select
                      value={item.effectiveSentiment === 'yetersiz-veri' ? '' : item.effectiveSentiment}
                      disabled={savingId === item.id || item.effectiveSentiment === 'yetersiz-veri'}
                      onChange={(e) => handleChangeTone(item, e.target.value)}
                    >
                      {item.effectiveSentiment === 'yetersiz-veri' && <option value="">Veri Yok</option>}
                      {TONE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {TONE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <ToneBadge tone={item.effectiveSentiment} />
                  )}
                </td>
                <td>
                  {item.override ? 'İnsan' : 'Yapay Zeka'}
                  {item.override && <HumanAuditIcon reviewer={item.override.reviewer} at={item.override.at} />}
                </td>
                <td>
                  {canEdit && item.override && (
                    <button
                      className="dashboard__link-btn"
                      disabled={savingId === item.id}
                      onClick={() => handleRevert(item)}
                      title="İnsan düzeltmesini sil, yapay zekanın orijinal tonuna geri dön"
                    >
                      AI önerisine dön
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
