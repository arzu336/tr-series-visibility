import { useState } from 'react'
import {
  fetchYoutubeStatus,
  syncYoutubeChannel,
  disconnectYoutubeChannel,
  runYoutubePublic,
  waitForJob,
} from '../lib/api.js'
import { useAsync } from '../lib/useAsync.js'

// Yönetim → YouTube bağlantıları. Kanal sahibi "Kanal bağla" ile açılan Google onay ekranında kendi hesabıyla
// salt okunur izin verir; dönüşte kanal burada listelenir ve her gün kendiliğinden eşitlenir.

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

/** Google dönüşünden gelen adres parametreleri: ?youtube=baglandi|hata|iptal&kanal=…&neden=… */
export function readYoutubeNotice(search = window.location.search) {
  const p = new URLSearchParams(search)
  const durum = p.get('youtube')
  if (!durum) return null
  if (durum === 'baglandi')
    return { ok: true, text: `${p.get('kanal') || 'Kanal'} bağlandı; ilk eşitleme başlatılabilir.` }
  if (durum === 'iptal') return { ok: false, text: 'Onay ekranında izin verilmedi; kanal bağlanmadı.' }
  return { ok: false, text: `Kanal bağlanamadı: ${p.get('neden') || 'bilinmeyen hata'}` }
}

export default function YoutubeConnections({ notice = null }) {
  const [refresh, setRefresh] = useState(0)
  const { status, data, error } = useAsync(fetchYoutubeStatus, [refresh])
  const [busy, setBusy] = useState({}) // channelId → metin
  const [message, setMessage] = useState(notice)

  async function handleSync(ch) {
    setBusy((b) => ({ ...b, [ch.channelId]: 'Eşitleniyor…' }))
    try {
      const { job } = await syncYoutubeChannel(ch.channelId)
      const r = await waitForJob(job.id, {
        onProgress: (j) =>
          setBusy((b) => ({
            ...b,
            [ch.channelId]:
              j.progress?.phase === 'reports'
                ? `Raporlar ${j.progress.done}/${j.progress.total} ay`
                : 'Videolar listeleniyor…',
          })),
      })
      setMessage({
        ok: true,
        text: `${ch.title}: ${r.newVideos} yeni video, ${r.matchedSeries} dizi, ${r.months} ay eşitlendi.${r.backfillDone ? '' : ' Eski videolar sonraki eşitlemelerde tamamlanacak.'}`,
      })
    } catch (err) {
      setMessage({ ok: false, text: `${ch.title} eşitlenemedi: ${err.message}` })
    } finally {
      setBusy((b) => ({ ...b, [ch.channelId]: null }))
      setRefresh((n) => n + 1)
    }
  }

  async function handlePublicRun() {
    setBusy((b) => ({ ...b, public: 'Toplanıyor…' }))
    try {
      const { job } = await runYoutubePublic()
      const r = await waitForJob(job.id)
      setMessage(
        r
          ? {
              ok: !r.errors?.length,
              text: `Herkese açık veri: ${r.videos} yeni video, ${r.statsVideos} videonun sayıları, ${r.commentSeries} dizinin yorum dili güncellendi (${r.quotaUsed} kota birimi).${r.quotaExhausted ? ' Günlük kota doldu; kalan iş yarın sürecek.' : ''}${r.errors?.length ? ` Hatalar: ${r.errors.join('; ')}` : ''}`,
            }
          : { ok: true, text: 'Toplama zaten sürüyor.' }
      )
    } catch (err) {
      setMessage({ ok: false, text: `Toplama başarısız: ${err.message}` })
    } finally {
      setBusy((b) => ({ ...b, public: null }))
      setRefresh((n) => n + 1)
    }
  }

  async function handleDisconnect(ch) {
    if (!window.confirm(`${ch.title} bağlantısı kaldırılsın mı? İzin geri alınır ve kanalın verisi silinir.`)) return
    setBusy((b) => ({ ...b, [ch.channelId]: 'Kaldırılıyor…' }))
    try {
      await disconnectYoutubeChannel(ch.channelId)
      setMessage({ ok: true, text: `${ch.title} bağlantısı kaldırıldı.` })
    } catch (err) {
      setMessage({ ok: false, text: err.message })
    } finally {
      setRefresh((n) => n + 1)
    }
  }

  return (
    <section className="dashboard__section" id="youtube-baglantilari">
      <h3 className="dashboard__section-title">YouTube bağlantıları</h3>
      <p className="dashboard__hint">
        Yayıncı kanalların izlenme raporları (ülke × ay). Kanal sahibi kendi Google hesabıyla salt okunur izin verir;
        platforma şifre gelmez, izin istendiğinde geri alınır.
      </p>
      {message && <div className={message.ok ? 'dashboard__bulk-bar' : 'status status--error'}>{message.text}</div>}
      {status === 'loading' && <p className="dashboard__empty">Yükleniyor…</p>}
      {status === 'error' && <p className="dashboard__empty">Durum alınamadı: {error}</p>}
      {status === 'ready' && !data.configured && (
        <div className="status status--error">
          Bağlantı henüz yapılandırılmadı. Sunucu ayarlarında eksik: {data.missing.join(', ')}. Kurulum adımları:
          docs/youtube-analytics-kurulum.md
        </div>
      )}
      {status === 'ready' && data.configured && (
        <>
          <p>
            <a className="series-page__btn series-page__btn--primary" href="/api/youtube/connect">
              Kanal bağla
            </a>
          </p>
          {data.channels.length === 0 ? (
            <p className="dashboard__empty">Henüz bağlı kanal yok.</p>
          ) : (
            <table className="dashboard__table dashboard__table--compact">
              <thead>
                <tr>
                  <th scope="col">Kanal</th>
                  <th scope="col">Video</th>
                  <th scope="col">Dizi</th>
                  <th scope="col">Ülke</th>
                  <th scope="col">Son ay</th>
                  <th scope="col">Son eşitleme</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.channels.map((ch) => (
                  <tr key={ch.channelId}>
                    <td>
                      {ch.title}
                      {ch.lastError && <div className="login__error">Hata: {ch.lastError}</div>}
                    </td>
                    <td>
                      {ch.videos}
                      {ch.videos > 0 && <small> ({ch.matchedVideos} eşlendi)</small>}
                      {!ch.backfillDone && ch.videos > 0 && <small> · eskiler sürüyor</small>}
                    </td>
                    <td>{ch.series}</td>
                    <td>{ch.countries}</td>
                    <td>{ch.lastPeriod ?? '—'}</td>
                    <td>{fmt(ch.lastSyncAt)}</td>
                    <td>
                      {busy[ch.channelId] ? (
                        <span className="dashboard__hint">{busy[ch.channelId]}</span>
                      ) : (
                        <>
                          <button type="button" className="dashboard__link-btn" onClick={() => handleSync(ch)}>
                            Şimdi eşitle
                          </button>{' '}
                          <button
                            type="button"
                            className="dashboard__link-btn dashboard__link-btn--danger"
                            onClick={() => handleDisconnect(ch)}
                          >
                            Bağlantıyı kaldır
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="dashboard__hint">Google'a tanımlı dönüş adresi: {data.redirectUri}</p>
        </>
      )}

      {status === 'ready' && data.public && (
        <>
          <h4 className="series-interest__title">Herkese açık veri (izin gerektirmez)</h4>
          <p className="dashboard__hint">
            Resmî yayıncı kanallarındaki videoların izlenme, beğeni ve yorum sayıları ile yorumların dili; günde bir
            toplanır. Ülke kırılımı yoktur.
          </p>
          {!data.public.configured ? (
            <div className="status status--error">
              YOUTUBE_API_KEY tanımlı değil. Kurulum: docs/youtube-analytics-kurulum.md (API anahtarı bölümü)
            </div>
          ) : (
            <>
              <p>
                {busy.public ? (
                  <span className="dashboard__hint">{busy.public}</span>
                ) : (
                  <button type="button" className="series-page__btn" onClick={handlePublicRun}>
                    Şimdi topla
                  </button>
                )}{' '}
                <span className="dashboard__hint">
                  Bugün {data.public.quotaUsedToday}/{data.public.dailyQuota} kota birimi · {data.public.series} dizi ·
                  son toplama {fmt(data.public.lastRunAt)}
                </span>
              </p>
              <table className="dashboard__table dashboard__table--compact">
                <thead>
                  <tr>
                    <th scope="col">Kanal</th>
                    <th scope="col">Video</th>
                    <th scope="col">Diziye eşlenen</th>
                    <th scope="col">Son çalışma</th>
                  </tr>
                </thead>
                <tbody>
                  {data.public.channels.map((c) => (
                    <tr key={c.handle}>
                      <td>
                        {c.title ?? c.handle} <small>{c.handle}</small>
                        {c.lastError && <div className="login__error">Hata: {c.lastError}</div>}
                      </td>
                      <td>
                        {c.videos}
                        {!c.backfillDone && c.videos > 0 && <small> · eskiler sürüyor</small>}
                      </td>
                      <td>{c.matched}</td>
                      <td>{fmt(c.lastRunAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}
