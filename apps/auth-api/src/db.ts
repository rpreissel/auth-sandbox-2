import { Pool, type PoolClient } from 'pg'

import { appConfig } from './config.js'

export const pool = new Pool({
  connectionString: appConfig.databaseUrl
})

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
