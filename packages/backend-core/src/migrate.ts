import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { pool } from './db.js'
import { logger } from './logger.js'

const defaultMigrationDirs = ['packages/backend-core/migrations']
const migrationLockKey: [number, number] = [847231, 1]

export async function runMigrations(migrationDirs = defaultMigrationDirs) {
  const migrationsDirs = await resolveMigrationDirs(migrationDirs)
  const client = await pool.connect()

  try {
    await client.query('select pg_advisory_lock($1, $2)', migrationLockKey)
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    for (const migrationsDir of migrationsDirs) {
      const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql')).sort()

      for (const entry of entries) {
        const existing = await client.query('select id from schema_migrations where id = $1', [entry])
        if (existing.rowCount) {
          continue
        }

        const sql = await readFile(path.join(migrationsDir, entry), 'utf8')
        await client.query(sql)
        await client.query('insert into schema_migrations (id) values ($1)', [entry])
        logger.info({ migration: entry }, 'Applied database migration')
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1, $2)', migrationLockKey)
    client.release()
  }
}

async function resolveMigrationDirs(migrationDirs: string[]) {
  const resolvedDirs: string[] = []

  for (const candidate of migrationDirs.map((entry) => path.resolve(process.cwd(), entry))) {
    try {
      await readdir(candidate)
      resolvedDirs.push(candidate)
    } catch {
      continue
    }
  }

  if (resolvedDirs.length === 0) {
    throw new Error(`No migrations directory found. Checked: ${migrationDirs.join(', ')}`)
  }

  return resolvedDirs
}
