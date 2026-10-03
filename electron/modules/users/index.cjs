const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')

function saveUser(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.username?.trim() || !input.displayName?.trim()) throw new Error('Username and display name are required')
    if (!['owner','sales','warehouse','purchasing'].includes(input.role)) throw new Error('Unsupported user role')
    const ctx = contextOf(options)
    if (ctx.role !== 'owner') throw new Error('Only an owner can manage users')
    if (Object.hasOwn(input, 'passwordHash') || Object.hasOwn(input, 'pinHash')) throw new Error('Hashes must never be accepted from the renderer')
    const userId = input.id || id('user'), date = nowDate(input.date)
    const prior = one(db, 'SELECT * FROM users WHERE id=?', [userId])
    if (prior?.id === ctx.userId && (input.isActive === false || input.role !== ctx.role)) throw new Error('An owner cannot deactivate or demote their own account')
    if (prior?.role === 'owner' && (input.role !== 'owner' || input.isActive === false) && one(db, "SELECT COUNT(*) AS n FROM users WHERE role='owner' AND is_active=1", []).n <= 1) throw new Error('The last active owner cannot be deactivated or demoted')
    const bcrypt = require('bcryptjs')
    if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 200)) throw new Error('Password must contain 10 to 200 characters')
    const passwordHash = input.password ? bcrypt.hashSync(input.password, 12) : prior?.password_hash
    if (!passwordHash) throw new Error('Raw password is required for a new user')
    let pinHash = prior?.pin_hash || null
    if (input.pin !== undefined) {
      if (typeof input.pin !== 'string' || !/^\d{4,8}$/.test(input.pin)) throw new Error('PIN must contain 4 to 8 digits')
      if (prior) {
        const actor = one(db, 'SELECT pin_hash FROM users WHERE id=?', [ctx.userId])
        if (!input.currentPin || !actor?.pin_hash || !bcrypt.compareSync(input.currentPin, actor.pin_hash)) throw new Error('Current PIN is required to change PIN')
      }
      pinHash = bcrypt.hashSync(input.pin, 12)
    }
    if (prior) write(db, control, 'user.update', 'UPDATE users SET username=?,display_name=?,role=?,password_hash=?,pin_hash=?,is_active=?,updated_at=? WHERE id=?', [input.username.trim(), input.displayName.trim(), input.role, passwordHash, pinHash, input.isActive === false ? 0 : 1, date, userId])
    else write(db, control, 'user.create', 'INSERT INTO users (id,username,display_name,role,password_hash,pin_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [userId, input.username.trim(), input.displayName.trim(), input.role, passwordHash, pinHash, input.isActive === false ? 0 : 1, date, date])
    audit(db, control, options, prior ? 'user.update' : 'user.create', 'user', userId, { username: input.username.trim(), role: input.role, passwordChanged: Boolean(input.password), pinChanged: input.pin !== undefined })
    return { id: userId }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'user:save', roles: ["owner"], handler: saveUser })
}

module.exports = { saveUser, register, snapshot: contributeSnapshot }
