import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { pool } from './db.js'
import { logger } from './logger.js'

const defaultMigrationDirs = ['packages/backend-core/migrations']
const migrationLockKey: [number, number] = [847231, 1]
const migrationRetryDelayMs = 1500
const migrationRetryCount = 20

export async function runMigrations(migrationDirs = defaultMigrationDirs) {
  const migrationsDirs = await resolveMigrationDirs(migrationDirs)
  for (let attempt = 1; attempt <= migrationRetryCount; attempt += 1) {
    let client

    try {
      client = await pool.connect()
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

      return
    } catch (error) {
      if (!isRetryableMigrationError(error) || attempt === migrationRetryCount) {
        throw error
      }

      logger.warn({ error, attempt, migrationRetryCount }, 'Database not ready for migrations yet, retrying')
      await delay(migrationRetryDelayMs)
    } finally {
      if (client) {
        try {
          await client.query('select pg_advisory_unlock($1, $2)', migrationLockKey)
        } catch {
          // Ignore unlock errors when the connection dropped before the lock was acquired.
        }
        client.release()
      }
    }
  }
}

function isRetryableMigrationError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? error.code : null
  return code === '57P03' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
