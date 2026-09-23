import crypto from 'node:crypto'

// Uzun süren, kullanıcı tetiklemeli işler için bellek içi iş kaydı. Basın taraması gibi işler
// (25 ülke × ≥20 sn GDELT aralığı ≈ 8+ dk) bir HTTP isteğinin içinde bekletilemez; uç 202 + iş
// kimliği döner, arayüz /api/jobs/:id ile ilerlemeyi izler. Kayıt süreç belleğinde tutulur:
// sunucu yeniden başlarsa iş kaybolur — arayüz bunu "iş bulunamadı" olarak görür ve yeniden
// başlatma önerir. Sonuçlar kalıcı olması gereken yerlerde (media_sentiment, cache_entries)
// zaten iş sırasında DB'ye yazılıyor; kaybolan yalnızca ilerleme görüntüsüdür.

const RETENTION_MS = 30 * 60 * 1000
const MAX_JOBS = 200

const jobs = new Map()
const byKey = new Map()

function prune(now = Date.now()) {
  for (const [id, job] of jobs) {
    const bitis = job.finishedAt
    if (bitis && now - bitis > RETENTION_MS) {
      jobs.delete(id)
      if (byKey.get(job.key) === id) byKey.delete(job.key)
    }
  }
  if (jobs.size > MAX_JOBS) {
    const bitmisler = [...jobs.values()].filter((j) => j.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt)
    for (const j of bitmisler.slice(0, jobs.size - MAX_JOBS)) {
      jobs.delete(j.id)
      if (byKey.get(j.key) === j.id) byKey.delete(j.key)
    }
  }
}

export function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    result: job.status === 'done' ? job.result : null,
    error: job.status === 'failed' ? job.error : null,
  }
}

/**
 * Bir iş başlatır ve hemen kaydını döner. `key` verilirse ve aynı anahtarlı bir iş hâlâ
 * sürüyorsa yeni iş açılmaz, mevcut kayıt döner (`existing: true`) — aynı diziye iki kez basmak
 * iki tarama başlatmasın. `runner(update)` bir söz döner; `update({ done, total, phase })`
 * ilerlemeyi yazar.
 */
export function startJob(type, runner, { key = null, meta = {} } = {}) {
  prune()
  if (key) {
    const mevcutId = byKey.get(key)
    const mevcut = mevcutId ? jobs.get(mevcutId) : null
    if (mevcut && (mevcut.status === 'queued' || mevcut.status === 'running')) {
      return { job: publicJob(mevcut), existing: true }
    }
  }

  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    type,
    key,
    meta,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    progress: null,
    result: null,
    error: null,
  }
  jobs.set(job.id, job)
  if (key) byKey.set(key, job.id)

  const update = (progress) => {
    if (job.status === 'running') job.progress = { ...(job.progress || {}), ...progress }
  }

  // Runner senkron bir istisna fırlatsa bile kayıt "failed" olur; çağıran hiçbir zaman fırlatma görmez.
  Promise.resolve()
    .then(() => {
      job.status = 'running'
      job.startedAt = Date.now()
      return runner(update)
    })
    .then((result) => {
      job.status = 'done'
      job.result = result ?? null
      job.finishedAt = Date.now()
    })
    .catch((err) => {
      job.status = 'failed'
      job.error = err?.message || String(err)
      job.finishedAt = Date.now()
      console.error(`[jobs] ${type} (${job.id}) başarısız:`, job.error)
    })

  return { job: publicJob(job), existing: false }
}

export function getJob(id) {
  prune()
  return publicJob(jobs.get(String(id)))
}

/** Test/izleme: kayıttaki tüm işlerin özeti. */
export function listJobs() {
  prune()
  return [...jobs.values()].map(publicJob)
}

/** Yalnızca testler için: kaydı sıfırlar. */
export function _resetJobsForTests() {
  jobs.clear()
  byKey.clear()
}
