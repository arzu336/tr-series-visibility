import { Router } from 'express'
import { getImage, isValidFile, isValidSize } from '../services/imageCache.js'

// Afiş ve oyuncu fotoğrafları sunucudan (services/imageCache.js): disk önbelleği, yoksa bir kez indirme.
// Oturum gerekmez (herkese açık görsel); yalnızca izinli boyut ve dosya adı kalıbı kabul edilir.

export const imagesRouter = Router()

imagesRouter.get('/api/img/:size/:file', async (req, res) => {
  const { size, file } = req.params
  if (!isValidSize(size) || !isValidFile(file)) return res.status(404).end()
  const local = await getImage(size, file)
  if (!local) return res.status(404).end()
  res.set('Cache-Control', 'public, max-age=2592000, immutable')
  res.sendFile(local)
})
