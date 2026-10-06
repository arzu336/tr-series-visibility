import express from 'express'
import { requireAdmin } from './auth.js'
import { startJob } from '../services/jobs.js'
import {
  youtubeConfig,
  createOAuthState,
  consumeOAuthState,
  buildAuthUrl,
  connectChannel,
  disconnectChannel,
  syncChannel,
  listChannels,
} from '../services/youtubeAnalytics.js'
import { publicStatus, runYoutubePublicIfNeeded, getSeriesYoutube } from '../services/youtubePublic.js'

// YouTube Analytics bağlantıları — yalnızca yönetici. Kanal sahibi Google onay ekranında kendi hesabıyla
// onaylar; platforma şifre gelmez, yalnızca salt okunur izin anahtarı (şifreli) saklanır.
export const youtubeRouter = express.Router()

youtubeRouter.use('/api/youtube', requireAdmin)

youtubeRouter.get('/api/youtube/status', (req, res) => {
  const cfg = youtubeConfig()
  res.json({
    configured: cfg.ready,
    missing: cfg.missing,
    redirectUri: cfg.redirectUri ?? null,
    channels: listChannels(),
    public: publicStatus(),
  })
})

// Herkese açık veri toplamasını hemen başlatır (günlük iş 24 saati beklemeden).
youtubeRouter.post('/api/youtube/public/run', (req, res) => {
  if (!publicStatus().configured) return res.status(400).json({ error: 'YOUTUBE_API_KEY tanımlı değil' })
  const { job, existing } = startJob('youtube-public', () => runYoutubePublicIfNeeded({ force: true }), {
    key: 'youtube-public',
  })
  res.status(202).json({ job, existing, statusUrl: `/api/jobs/${job.id}` })
})

// Dizi sayfası (oturum açmış her kullanıcı): resmî kanallardaki herkese açık sayılar ve yorum dili.
youtubeRouter.get('/api/series/:id/youtube', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Geçersiz dizi kimliği' })
  res.json(getSeriesYoutube(id) ?? { status: 'yok' })
})

// Tarayıcı bu adrese gider (fetch değil): Google onay ekranına yönlendirilir.
youtubeRouter.get('/api/youtube/connect', (req, res) => {
  const cfg = youtubeConfig()
  if (!cfg.ready)
    return res.status(400).json({ error: `YouTube bağlantısı yapılandırılmamış: ${cfg.missing.join(', ')}` })
  res.redirect(buildAuthUrl(createOAuthState(req.currentUser.id), cfg))
})

// Google'ın geri dönüşü. Sonuç arayüze adres parametresiyle bildirilir (yönetim ekranı açılır).
youtubeRouter.get('/api/youtube/oauth/callback', async (req, res) => {
  const back = (params) => res.redirect(`/?${new URLSearchParams({ yonetim: 'youtube', ...params })}`)
  const { code, state, error } = req.query
  if (error) return back({ youtube: 'iptal', neden: String(error) })
  if (!code || !state || !consumeOAuthState(String(state), req.currentUser.id)) {
    return back({ youtube: 'hata', neden: 'Oturum doğrulanamadı; bağlantıyı yeniden başlatın.' })
  }
  try {
    const { title } = await connectChannel({ code: String(code), userId: req.currentUser.id })
    back({ youtube: 'baglandi', kanal: title })
  } catch (err) {
    console.error('[youtube] kanal bağlanamadı:', err.message)
    back({ youtube: 'hata', neden: err.message })
  }
})

youtubeRouter.post('/api/youtube/channels/:id/sync', (req, res) => {
  const channelId = req.params.id
  if (!listChannels().some((c) => c.channelId === channelId))
    return res.status(404).json({ error: 'Kanal bağlı değil' })
  const { job, existing } = startJob(
    'youtube-sync',
    (update) => syncChannel(channelId, { onProgress: (p) => update(p) }),
    { key: `youtube-sync:${channelId}` }
  )
  res.status(202).json({ job, existing, statusUrl: `/api/jobs/${job.id}` })
})

youtubeRouter.delete('/api/youtube/channels/:id', async (req, res) => {
  const ok = await disconnectChannel(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Kanal bağlı değil' })
  res.json({ ok: true })
})
