import crypto from 'node:crypto'
import db from './db.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün
export const COOKIE_NAME = 'gp_session'

const insertStmt = db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
const selectStmt = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token = ?')

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  insertStmt.run(token, userId, Date.now() + SESSION_TTL_MS)
  return token
}

export function isValidSession(token) {
  if (!token) return false
  const entry = selectStmt.get(token)
  if (!entry) return false
  if (Date.now() > entry.expires_at) {
    deleteStmt.run(token)
    return false
  }
  return true
}

export function getSessionUserId(token) {
  if (!token) return null
  const entry = selectStmt.get(token)
  if (!entry || Date.now() > entry.expires_at) return null
  return entry.user_id
}

export function deleteSession(token) {
  if (!token) return
  deleteStmt.run(token)
}

export function parseCookies(header) {
  const result = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

export function sessionCookieHeader(token, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  return parts.join('; ')
}
