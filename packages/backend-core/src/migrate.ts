import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { pool } from './db.js'
import { logger } from './logger.js'

const defaultMigrationDirs = ['packages/backend-core/migrations']

export async function runMigrations(migrationDirs = defaultMigrationDirs) {
  const migrationsDirs = await resolveMigrationDirs(migrationDirs)
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  for (const migrationsDir of migrationsDirs) {
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
