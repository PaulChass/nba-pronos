// Pseudo + PIN authentication. Server-only.
//
// - PINs are 6 digits, hashed with scrypt (random 16-byte salt) and compared in constant time.
// - 5 wrong PINs lock the account for 15 minutes (state kept on the users row: no extra infra).
// - The session cookie is `userId.sessionVersion.hmac`, signed with SESSION_SECRET. Bumping
//   users.session_version (PIN reset) invalidates every existing session.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { sql } from './db'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const SESSION_COOKIE = 'pronos_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 300 // the whole season
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

export interface User {
  id: number
  pseudo: string
  isAdmin: boolean
}

// ---------------------------------------------------------------- pseudo & PIN rules

/** Display form: trimmed, inner whitespace collapsed. */
export function cleanPseudo(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

/** Uniqueness/login key: case-insensitive. */
export function pseudoKey(raw: string): string {
  return cleanPseudo(raw).toLowerCase()
}

export function pseudoError(raw: string): string | null {
  const p = cleanPseudo(raw)
  if (p.length < 2 || p.length > 20) return 'Le pseudo doit faire entre 2 et 20 caractères.'
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(p)) return 'Lettres, chiffres, espaces, points, tirets et apostrophes uniquement.'
  // Also rules out "." / ".." which would collapse as URL path segments (/joueur/..).
  if (!/[\p{L}\p{N}]/u.test(p)) return 'Le pseudo doit contenir au moins une lettre ou un chiffre.'
  return null
}

export function pinError(pin: string): string | null {
  return /^\d{6}$/.test(pin) ? null : 'Le code PIN doit contenir exactement 6 chiffres.'
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pin, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(pin, Buffer.from(saltB64, 'base64'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ---------------------------------------------------------------- session cookie

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ chars)')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function encodeSession(userId: number, version: number): string {
  const payload = `${userId}.${version}`
  return `${payload}.${sign(payload)}`
}

export function decodeSession(value: string | undefined): { userId: number; version: number } | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [id, version, mac] = parts
  const expected = Buffer.from(sign(`${id}.${version}`))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const userId = Number(id)
  const v = Number(version)
  return Number.isInteger(userId) && Number.isInteger(v) ? { userId, version: v } : null
}

/** Call only from a Server Function or Route Handler. */
export async function setSessionCookie(userId: number, version: number): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, encodeSession(userId, version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

/** Call only from a Server Function or Route Handler. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

function isAdminKey(key: string): boolean {
  const admin = process.env.ADMIN_PSEUDO
  return !!admin && pseudoKey(admin) === key
}

/** The signed-in user, or null. Safe to call from Server Components. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies()
  const session = decodeSession(store.get(SESSION_COOKIE)?.value)
  if (!session) return null
  const rows = await sql()`
    select id, pseudo, pseudo_key, session_version from users where id = ${session.userId}`
  const row = rows[0]
  if (!row || row.session_version !== session.version) return null
  return { id: row.id, pseudo: row.pseudo, isAdmin: isAdminKey(row.pseudo_key) }
}

// ---------------------------------------------------------------- account operations

export type AuthResult = { ok: true; user: User; version: number } | { ok: false; error: string }

export async function createAccount(rawPseudo: string, pin: string): Promise<AuthResult> {
  const err = pseudoError(rawPseudo) ?? pinError(pin)
  if (err) return { ok: false, error: err }
  const pseudo = cleanPseudo(rawPseudo)
  const key = pseudoKey(rawPseudo)
  const pinHash = await hashPin(pin)
  const rows = await sql()`
    insert into users (pseudo, pseudo_key, pin_hash) values (${pseudo}, ${key}, ${pinHash})
    on conflict (pseudo_key) do nothing
    returning id, session_version`
  if (!rows.length) return { ok: false, error: 'Ce pseudo est déjà pris.' }
  return {
    ok: true,
    user: { id: rows[0].id, pseudo, isAdmin: isAdminKey(key) },
    version: rows[0].session_version,
  }
}

export async function authenticate(rawPseudo: string, pin: string): Promise<AuthResult> {
  const generic = 'Pseudo ou code PIN incorrect.'
  if (pinError(pin)) return { ok: false, error: generic }
  const key = pseudoKey(rawPseudo)
  const lockedError = `Trop d’essais : compte bloqué ${LOCKOUT_MINUTES} minutes. Réessaie plus tard.`
  // Claim the attempt BEFORE checking the PIN, in the same statement as the lock check: concurrent
  // UPDATEs on the row serialize, so a burst of parallel guesses cannot all slip in before the
  // 5th failure sets the lock. The 5th claim sets the lock and resets the counter.
  const rows = await sql()`
    update users set
      failed_attempts = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS} then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
        then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else null end
    where pseudo_key = ${key} and (locked_until is null or locked_until <= now())
    returning id, pseudo, pin_hash, locked_until, session_version`
  const row = rows[0]
  if (!row) {
    await hashPin(pin) // keep timing similar to the "known pseudo" path
    const known = await sql()`select locked_until from users where pseudo_key = ${key}`
    const locked = known[0]?.locked_until && new Date(known[0].locked_until).getTime() > Date.now()
    return { ok: false, error: locked ? lockedError : generic }
  }
  if (!(await verifyPin(pin, row.pin_hash))) {
    const lockedNow = row.locked_until && new Date(row.locked_until).getTime() > Date.now()
    return { ok: false, error: lockedNow ? lockedError : generic }
  }
  // Right PIN: this attempt was already counted, so the reset is unconditional (a correct 5th
  // attempt must still log in even though its claim just set the lock).
  await sql()`update users set failed_attempts = 0, locked_until = null where id = ${row.id}`
  return {
    ok: true,
    user: { id: row.id, pseudo: row.pseudo, isAdmin: isAdminKey(key) },
    version: row.session_version,
  }
}

/** Admin: sets a new PIN and logs the user out everywhere. */
export async function resetPin(userId: number, newPin: string): Promise<{ ok: boolean; error?: string }> {
  const err = pinError(newPin)
  if (err) return { ok: false, error: err }
  const pinHash = await hashPin(newPin)
  const rows = await sql()`
    update users set pin_hash = ${pinHash}, failed_attempts = 0, locked_until = null,
      session_version = session_version + 1
    where id = ${userId} returning id`
  return rows.length ? { ok: true } : { ok: false, error: 'Utilisateur introuvable.' }
}
