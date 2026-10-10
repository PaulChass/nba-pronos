// Applies scripts/schema.sql to the database in DATABASE_URL_UNPOOLED / DATABASE_URL
// (read from the environment or .env.local). Usage: `npm run db:schema`.
import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'

async function envFromFile() {
  try {
    const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch {
    // no .env.local: rely on the real environment
  }
}

await envFromFile()
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (run `npx vercel env pull .env.local`).')

const sql = neon(url)
const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
for (const statement of statements) await sql.query(statement)
console.log(`schema applied (${statements.length} statements)`)
