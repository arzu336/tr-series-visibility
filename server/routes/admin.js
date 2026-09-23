import express from 'express'
import { deleteSessionsForUser } from '../auth.js'
import { listUsers, setUserStatus, setUserAccessLevel, resetUserPassword, deleteUser, publicUser } from '../users.js'
import { requireAdmin } from './auth.js'
import { badRequest } from './shared.js'

export const adminRouter = express.Router()

adminRouter.use('/api/admin', requireAdmin)

adminRouter.get('/api/admin/users', (req, res) => {
  res.json({ items: listUsers().map(publicUser) })
})

adminRouter.post(
  '/api/admin/users/:id/approve',
  badRequest((req, res) => {
    res.json(publicUser(setUserStatus(req.params.id, 'approved', req.currentUser.id)))
  })
)

adminRouter.post(
  '/api/admin/users/:id/reject',
  badRequest((req, res) => {
    const entry = setUserStatus(req.params.id, 'rejected', req.currentUser.id)
    deleteSessionsForUser(req.params.id)
    res.json(publicUser(entry))
  })
)

adminRouter.post(
  '/api/admin/users/:id/access-level',
  badRequest((req, res) => {
    const { accessLevel } = req.body || {}
    res.json(publicUser(setUserAccessLevel(req.params.id, accessLevel, req.currentUser.id)))
  })
)

adminRouter.post(
  '/api/admin/users/:id/reset-password',
  badRequest((req, res) => {
    const tempPassword = resetUserPassword(req.params.id)
    deleteSessionsForUser(req.params.id)
    res.json({ tempPassword })
  })
)

adminRouter.post(
  '/api/admin/users/:id/delete',
  badRequest((req, res) => {
    deleteUser(req.params.id, req.currentUser.id)
    deleteSessionsForUser(req.params.id)
    res.json({ ok: true })
  })
)
