// Server-only Postgres access (Neon HTTP driver). Use as a tagged template:
//   const rows = await sql()`select * from users where id = ${id}`
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let client: NeonQueryFunction<false, false> | null = null

export function sql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    client = neon(url)
  }
  return client
}

export async function kvGet<T>(key: string): Promise<{ value: T; updatedAt: string } | null> {
  const rows = await sql()`select value, updated_at from kv where key = ${key}`
  if (!rows.length) return null
  return { value: rows[0].value as T, updatedAt: new Date(rows[0].updated_at).toISOString() }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await sql()`
    insert into kv (key, value, updated_at) values (${key}, ${JSON.stringify(value)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`
}
