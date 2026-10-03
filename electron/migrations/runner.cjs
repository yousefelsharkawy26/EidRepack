const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const MIGRATIONS_DIR = __dirname

function configureDatabase(database) {
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
}

function hasTable(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function loadMigrations(directory = MIGRATIONS_DIR) {
  return fs.readdirSync(directory)
    .filter(name => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort()
    .map(name => ({
      version: Number(name.slice(0, 3)),
      name,
      sql: fs.readFileSync(path.join(directory, name), 'utf8'),
      checksum: createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')
    }))
}

function applyMigrations(database, directory = MIGRATIONS_DIR) {
  const applied = []
  const migrations = loadMigrations(directory)
  if (!migrations.length) throw new Error(`No numbered SQL migrations found in ${directory}`)

  const checksumTableExists = hasTable(database, 'migration_checksums')
  const initialVersion = hasTable(database, 'schema_version')
    ? database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get().version
    : 0
  if (checksumTableExists) {
    for (const migration of migrations) {
      if (migration.version > initialVersion) continue
      const recorded = database.prepare('SELECT checksum FROM migration_checksums WHERE version=?').get(migration.version)
      if (!recorded) throw new Error(`Migration checksum is missing for ${migration.name} (version ${migration.version})`)
      if (recorded.checksum !== migration.checksum) throw new Error(`Migration checksum mismatch for ${migration.name} (version ${migration.version})`)
    }
  }

  for (const migration of migrations) {
    const current = hasTable(database, 'schema_version')
      ? database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get().version
      : 0
    if (migration.version <= current) continue

    const applyOne = database.transaction(() => {
      database.exec(migration.sql)
      database.prepare('INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)')
        .run(migration.version, new Date().toISOString(), migration.name)
      if (hasTable(database, 'migration_checksums')) database.prepare('INSERT INTO migration_checksums (version,checksum,recorded_at) VALUES (?,?,?)').run(migration.version, migration.checksum, new Date().toISOString())
    })
    applyOne.immediate()
    applied.push(migration.version)
  }

  const checksumVersion = migrations.find(row => row.version === 5)?.version
  const finalVersion = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get().version
  if (checksumVersion && finalVersion >= checksumVersion && !hasTable(database, 'migration_checksums')) {
    throw new Error('Migration checksum table is missing')
  }
  if (hasTable(database, 'migration_checksums') && !checksumTableExists && applied.includes(checksumVersion)) {
    const current = database.prepare('SELECT version FROM schema_version ORDER BY version').all()
    const recordMissing = database.transaction(rows => {
      for (const { version } of rows) {
        const migration = migrations.find(candidate => candidate.version === version)
        if (!migration) throw new Error(`Applied migration ${version} has no source file`)
        database.prepare('INSERT OR IGNORE INTO migration_checksums (version,checksum,recorded_at) VALUES (?,?,?)').run(version, migration.checksum, new Date().toISOString())
      }
    })
    recordMissing.immediate(current)
  }

  return applied
}

module.exports = { applyMigrations, configureDatabase, loadMigrations }
