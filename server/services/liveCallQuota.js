import { AsyncLocalStorage } from 'node:async_hooks'
import db from '../db.js'

const requestContext = new AsyncLocalStorage()

export function runWithUserContext(userId, fn) {
  return requestContext.run({ userId }, fn)
}

function getUserDailyLimit() {
  return Number(process.env.SERPAPI_USER_DAILY_LIMIT) || 150
}

function dayKeyFor(userId, now = new Date()) {
  return `liveCalls:${now.toISOString().slice(0, 10)}:${userId}`
}

const reserveStmt = db.prepare(`
  INSERT INTO meta (key, value) VALUES (?, '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
  RETURNING CAST(value AS INTEGER) AS value
`)
const releaseStmt = db.prepare('UPDATE meta SET value = CAST(value AS INTEGER) - 1 WHERE key = ?')
const readStmt = db.prepare('SELECT value FROM meta WHERE key = ?')

/**
 * Gerçekten dışarıya çıkan bir çağrıdan hemen ÖNCE çağrılır. Kota aşılırsa rezervasyonu geri
 * alıp 429 fırlatır. Dönen fonksiyon, çağrı başarısız olduğunda rezervasyonu serbest bırakmak
 * içindir (başarısız çağrı kotadan düşmez — aylık sayaçla aynı ilke).
 */
export function chargeCurrentUserForLiveCall() {
  const store = requestContext.getStore()
  if (!store?.userId) return () => {}

  const key = dayKeyFor(store.userId)
  const limit = getUserDailyLimit()
  const used = reserveStmt.get(key).value
  if (used > limit) {
    releaseStmt.run(key)
    const err = new Error(
      `Günlük canlı sorgu sınırınıza ulaştınız (${limit}). Önbellekten gelen veriler etkilenmez, sınır her gün sıfırlanır.`
    )
    err.status = 429
    throw err
  }
  return () => releaseStmt.run(key)
}

export function getUserLiveCallUsage(userId, now = new Date()) {
  const row = readStmt.get(dayKeyFor(userId, now))
  return { used: row ? Number(row.value) : 0, limit: getUserDailyLimit() }
}
