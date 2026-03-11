import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appConfig } from './config.js'
import { pool } from './db.js'
import { logger } from './logger.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const candidateDirs = [
  path.resolve(currentDir, '../migrations'),
  path.resolve(currentDir, '../../../apps/auth-api/migrations'),
  path.resolve(process.cwd(), 'apps/auth-api/migrations')
]

export async function runMigrations() {
  const migrationsDir = await resolveMigrationsDir()
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const entries = (await readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql')).sort()

  for (const entry of entries) {
    const existing = await pool.query('select id from schema_migrations where id = $1', [entry])
    if (existing.rowCount) {
      continue
    }

    const sql = await readFile(path.join(migrationsDir, entry), 'utf8')
    await pool.query(sql)
    await pool.query('insert into schema_migrations (id) values ($1)', [entry])
    logger.info({ migration: entry }, 'Applied database migration')
  }
}

async function resolveMigrationsDir() {
  for (const candidate of candidateDirs) {
    try {
      await readdir(candidate)
      return candidate
    } catch {
      continue
    }
  }

  throw new Error(`No migrations directory found. Checked: ${candidateDirs.join(', ')}`)
}
