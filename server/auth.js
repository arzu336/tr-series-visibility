import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS_PATH = path.join(__dirname, 'data', 'sessions.json')
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 gün
export const COOKIE_NAME = 'gp_session'

function loadSessions() {
  if (!fs.existsSync(SESSIONS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveSessions(sessions) {
  fs.mkdirSync(path.dirname(SESSIONS_PATH), { recursive: true })
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions), 'utf8')
}

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  const sessions = loadSessions()
  sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL_MS }
  saveSessions(sessions)
  return token
}

export function isValidSession(token) {
  if (!token) return false
  const sessions = loadSessions()
  const entry = sessions[token]
  if (!entry) return false
  if (Date.now() > entry.expiresAt) {
    delete sessions[token]
    saveSessions(sessions)
    return false
  }
  return true
}

export function getSessionUserId(token) {
  if (!token) return null
  const sessions = loadSessions()
  const entry = sessions[token]
  if (!entry || Date.now() > entry.expiresAt) return null
  return entry.userId
}

export function deleteSession(token) {
  if (!token) return
  const sessions = loadSessions()
  if (sessions[token]) {
    delete sessions[token]
    saveSessions(sessions)
  }
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
