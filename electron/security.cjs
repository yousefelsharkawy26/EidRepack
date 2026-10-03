const bcrypt = require('bcryptjs')
const { z } = require('zod')
const { randomUUID } = require('node:crypto')
const { permissionsForRole } = require('./core/policy.cjs')

const roles = ['owner', 'sales', 'warehouse', 'purchasing']
const loginSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }).strict()
const bootstrapSchema = z.object({ username: z.string().trim().min(1).max(80), displayName: z.string().trim().min(1).max(120), password: z.string().min(10).max(200), pin: z.string().regex(/^\d{4,8}$/) }).strict()
const elevateSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/), scope: z.enum(['inventory-adjustment', 'customer-credit']) }).strict()

function createSecurity(database) {
  const sessions = new Map()
  const failures = new Map()
  const pinFailures = new Map()
  function userById(userId) { return database.prepare('SELECT id,username,display_name,role,is_active FROM users WHERE id=?').get(userId) }
  function safeUser(user) { return { id: user.id, username: user.username, displayName: user.display_name, role: user.role, permissions: permissionsForRole(user.role) } }
  function bootstrap(payload) {
    const input = bootstrapSchema.parse(payload)
    return database.transaction(() => {
      if (database.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('Owner setup is available only before the first user exists')
      const date = new Date().toISOString()
      const id = randomUUID()
      database.prepare('INSERT INTO users (id,username,display_name,role,password_hash,pin_hash,is_active,created_at,updated_at) VALUES (?,?,?,\'owner\',?,?,1,?,?)')
        .run(id, input.username, input.displayName, bcrypt.hashSync(input.password, 12), bcrypt.hashSync(input.pin, 12), date, date)
      database.prepare('INSERT INTO audit_log (id,user_id,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), id, 'auth.bootstrap', 'user', id, JSON.stringify({ username: input.username, role: 'owner' }), date)
      return { id, username: input.username, displayName: input.displayName, role: 'owner', permissions: permissionsForRole('owner') }
    }).immediate()
  }
  function login(webContents, payload) {
    const input = loginSchema.parse(payload)
    const key = input.username.toLowerCase()
    const current = failures.get(key) || { count: 0, nextAt: 0 }
    if (Date.now() < current.nextAt) throw new Error('Too many login attempts; try again later')
    const user = database.prepare('SELECT * FROM users WHERE username=? AND is_active=1').get(input.username)
    if (!user || !bcrypt.compareSync(input.password, user.password_hash)) {
      current.count += 1
      current.nextAt = current.count >= 5 ? Date.now() + Math.min(300000, 30000 * (current.count - 4)) : 0
      failures.set(key, current)
      throw new Error('Invalid username or password')
    }
    failures.delete(key)
    sessions.set(webContents.id, { userId: user.id, elevation: null })
    return safeUser(user)
  }
  function context(event) {
    const session = sessions.get(event.sender.id)
    if (!session) throw new Error('Authentication required')
    const user = userById(session.userId)
    if (!user?.is_active) { sessions.delete(event.sender.id); throw new Error('Session expired') }
    if (session.elevation && session.elevation.expiresAt <= Date.now()) session.elevation = null
    return { userId: user.id, role: user.role, elevation: session.elevation || null }
  }
  function session(event) {
    const ctx = context(event)
    return safeUser(userById(ctx.userId))
  }
  function logout(event) { sessions.delete(event.sender.id); return true }
  function invalidate(userId) {
    for (const [webContentsId, session] of sessions) if (session.userId === userId) sessions.delete(webContentsId)
  }
  function elevate(event, payload) {
    const input = elevateSchema.parse(payload)
    const ctx = context(event)
    const attempts = pinFailures.get(ctx.userId) || { count: 0, nextAt: 0 }
    if (Date.now() < attempts.nextAt) throw new Error('Too many PIN attempts; try again later')
    // The approver may be the session user themself, or any active owner who
    // types their own PIN to authorize the action on behalf of the actor.
    const own = database.prepare('SELECT id,pin_hash FROM users WHERE id=?').get(ctx.userId)
    let approverId = null
    if (own?.pin_hash && bcrypt.compareSync(input.pin, own.pin_hash)) approverId = own.id
    if (!approverId) {
      for (const owner of database.prepare("SELECT id,pin_hash FROM users WHERE role='owner' AND is_active=1").all()) {
        if (owner.pin_hash && bcrypt.compareSync(input.pin, owner.pin_hash)) { approverId = owner.id; break }
      }
    }
    if (!approverId) {
      attempts.count += 1
      if (attempts.count >= 5) attempts.nextAt = Date.now() + Math.min(300000, 30000 * (attempts.count - 4))
      pinFailures.set(ctx.userId, attempts)
      throw new Error('Invalid PIN')
    }
    pinFailures.delete(ctx.userId)
    const createdAt = new Date().toISOString()
    database.transaction(() => {
      database.prepare('INSERT INTO audit_log (id,user_id,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), ctx.userId, 'security.elevation', 'session', String(event.sender.id), JSON.stringify({ scope: input.scope, approverId, ttlSeconds: 180 }), createdAt)
    }).immediate()
    sessions.set(event.sender.id, { userId: ctx.userId, elevation: { userId: approverId, scope: input.scope, expiresAt: Date.now() + 180000 } })
    return { scope: input.scope, expiresInSeconds: 180 }
  }
  return { bootstrap, context, elevate, invalidate, login, logout, session, sessions, roles }
}

module.exports = { createSecurity }
