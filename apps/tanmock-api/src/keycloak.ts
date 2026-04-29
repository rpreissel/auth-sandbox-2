import { pool } from '@auth-sandbox-2/backend-core'

export type SourceIdentity = {
  userId: string
  firstName: string
  lastName: string
  birthDate: string
  phoneNumber: string | null
}

export async function fetchSourceIdentity(sourceUserId: string): Promise<SourceIdentity | null> {
  const result = await pool.query<{
    user_id: string
    first_name: string
    last_name: string
    birth_date: string
    phone_number: string | null
  }>(`
    select
      people.user_id,
      people.first_name,
      people.last_name,
      people.birth_date::text,
      sms.phone_number
    from registration_people people
    left join registration_person_sms_numbers sms on sms.person_id = people.id
    where people.user_id = $1
    limit 1
  `, [sourceUserId])

  const row = result.rows[0]
  if (!row) {
    return null
  }

  return {
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    phoneNumber: row.phone_number
  }
}
