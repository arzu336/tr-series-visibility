const UPSTREAM_ERROR_MESSAGE = 'Dış veri kaynağına şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyin.'

/** Dış kaynak hatası: kota (429) olduğu gibi, gerisi 502 + genel mesaj (iç hata metni sızmaz). */
export function sendUpstreamError(res, err) {
  if (err?.status === 429) return res.status(429).json({ error: err.message })
  return res.status(502).json({ error: UPSTREAM_ERROR_MESSAGE })
}

/** try/catch + günlük + sendUpstreamError kalıbını tek yerde toplar. */
export function upstream(tag, handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      console.error(`[${tag}] hata:`, err.message)
      sendUpstreamError(res, err)
    }
  }
}

/** Doğrulama hatası: 400 + mesaj. */
export function badRequest(handler) {
  return (req, res) => {
    try {
      handler(req, res)
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  }
}
