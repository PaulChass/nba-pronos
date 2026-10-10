// Question results = ESPN auto-detection (lib/espn.ts), overridden by the admin when needed.
// Server-only. Overrides live in the `results` table, one row per question; the admin always wins.
import { QUESTION_BY_ID, QUESTIONS } from '@/config/questions'
import { sql } from './db'
import { forgetAutoResult, getAutoResults } from './espn'
import type { QuestionId, QuestionResult, Results } from './types'
import { teamAnswerValid } from './validation'

const MAX_WINNERS = 5 // shared awards: co-winners all score

export const isQuestionId = (q: unknown): q is QuestionId =>
  typeof q === 'string' && Object.hasOwn(QUESTION_BY_ID, q)

/**
 * Validates an untrusted result for question `q` and returns a clean copy, or null if invalid.
 * Team questions need tricodes of the right conference; player/coach questions need ESPN ids
 * (digits). A winner missing from our player list is accepted: nobody could pick him, but the
 * question is still settled.
 */
export function normalizeResult(q: QuestionId, input: unknown, source: 'auto' | 'admin'): QuestionResult | null {
  if (!isQuestionId(q) || !input || typeof input !== 'object') return null
  const r = input as { status?: unknown; winners?: unknown }
  if (r.status === 'pending') return { status: 'pending' }
  if (r.status === 'void') return { status: 'void' }
  if (r.status !== 'final' || !Array.isArray(r.winners)) return null
  const winners = [...new Set(r.winners.map((w) => (typeof w === 'string' ? w.trim() : w)))]
  if (winners.length === 0 || winners.length > MAX_WINNERS) return null
  const kind = QUESTION_BY_ID[q].kind
  for (const w of winners) {
    if (typeof w !== 'string') return null
    const team = teamAnswerValid(kind, w)
    if (team === null ? !/^\d{1,12}$/.test(w) : !team) return null
  }
  return { status: 'final', winners: winners as string[], source }
}

/** Current admin overrides only (for the admin page). Rows that no longer validate are ignored. */
export async function getAdminOverrides(): Promise<Results> {
  const rows = await sql()`select question_id, answer from results`
  const out: Results = {}
  for (const row of rows) {
    const q = row.question_id
    if (!isQuestionId(q)) continue
    const r = normalizeResult(q, row.answer, 'admin')
    if (r) out[q] = r
  }
  return out
}

/** Auto results merged with admin overrides (admin wins). Every question present. */
export async function getResults(): Promise<Results> {
  const [auto, admin] = await Promise.all([getAutoResults(), getAdminOverrides()])
  const out: Results = {}
  for (const q of QUESTIONS) out[q.id] = admin[q.id] ?? auto[q.id] ?? { status: 'pending' }
  return out
}

/**
 * Admin override for one question; null removes the override (back to auto).
 * `{ status: 'pending' }` is a valid override too: it hides a wrong auto result until fixed.
 * Throws (French message) on an unknown question or an invalid result.
 */
export async function setAdminResult(q: QuestionId, result: QuestionResult | null): Promise<void> {
  if (!isQuestionId(q)) throw new Error('Question inconnue.')
  if (result === null) {
    await sql()`delete from results where question_id = ${q}`
    await forgetAutoResult(q).catch((err) => console.warn('[results] could not reset the auto result:', err))
    return
  }
  const clean = normalizeResult(q, result, 'admin')
  if (!clean) throw new Error('Résultat invalide pour cette question.')
  // Stored without `source`: everything in this table is an admin decision.
  const answer = clean.status === 'final' ? { status: 'final', winners: clean.winners } : { status: clean.status }
  await sql()`
    insert into results (question_id, answer, updated_at) values (${q}, ${JSON.stringify(answer)}::jsonb, now())
    on conflict (question_id) do update set answer = excluded.answer, updated_at = now()`
}
