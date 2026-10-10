'use server'

// Admin-only Server Functions (Paul). Each one re-checks the session itself: only rendering the
// admin page for Paul is not a security boundary, anyone can POST to an action.
import { randomInt } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { refreshAutoResults, refreshStandings } from '@/lib/espn'
import { QUESTIONS } from '@/config/questions'
import { getCurrentUser, resetPin } from '@/lib/auth'
import { answerLabel, COACHES, PLAYERS } from '@/lib/data'
import { sql } from '@/lib/db'
import { setAdminResult } from '@/lib/results'
import type { AnswerKind, QuestionResult } from '@/lib/types'
import { teamAnswerValid } from '@/lib/validation'

export type ResetPinState =
  | { status: 'idle' }
  | { status: 'ok'; pin: string; pseudo: string }
  | { status: 'error'; error: string }

export interface AdminMessage {
  ok: boolean
  message: string
}

const FORBIDDEN = 'Réservé à l’admin.'

async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null)
  return user?.isAdmin === true
}

/**
 * Every page whose content depends on results or standings. The 'layout' form hits the implicit
 * tag of each segment, so nested routes (/joueur/[pseudo], /classement/…) are covered whatever
 * their param names; cached ESPN fetches made while rendering them are refetched on next visit.
 */
function revalidateScores(): void {
  revalidatePath('/')
  revalidatePath('/classement', 'layout')
  revalidatePath('/consensus', 'layout')
  revalidatePath('/joueur', 'layout')
  revalidatePath('/admin')
}

// ---------------------------------------------------------------- PIN reset

/** Draws a new random 6-digit PIN for a player. The PIN is returned once and never stored in clear. */
export async function resetPinAction(userId: number): Promise<ResetPinState> {
  if (!(await isAdmin())) return { status: 'error', error: FORBIDDEN }
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    return { status: 'error', error: 'Choisis un joueur.' }
  }
  try {
    const rows = await sql()`select pseudo from users where id = ${userId}`
    if (!rows.length) return { status: 'error', error: 'Joueur introuvable.' }
    // randomInt uses the CSPRNG; padStart keeps PINs like 004213 at 6 digits.
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const res = await resetPin(userId, pin)
    if (!res.ok) return { status: 'error', error: res.error ?? 'Réinitialisation impossible.' }
    return { status: 'ok', pin, pseudo: String(rows[0].pseudo) }
  } catch {
    return { status: 'error', error: 'La base de données ne répond pas : réessaie.' }
  }
}

// ---------------------------------------------------------------- question results

const norm = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** Lower-cased label -> id. Labels are the datalist values ("Victor Wembanyama (SAS)"). */
function buildIndex(items: readonly { id: string; name: string }[], kind: AnswerKind): Map<string, string> {
  const index = new Map<string, string>()
  const nameCount = new Map<string, number>()
  for (const it of items) nameCount.set(norm(it.name), (nameCount.get(norm(it.name)) ?? 0) + 1)
  for (const it of items) {
    index.set(norm(answerLabel(kind, it.id)), it.id)
    // The bare name is accepted too, but only when no other entry shares it.
    if (nameCount.get(norm(it.name)) === 1) index.set(norm(it.name), it.id)
  }
  return index
}

let playerIndex: Map<string, string> | null = null
let coachIndex: Map<string, string> | null = null

/** Maps a submitted value back to an answer id (team tricode, ESPN player/coach id), or null. */
function resolveWinner(kind: AnswerKind, raw: string): string | null {
  const team = teamAnswerValid(kind, raw)
  if (team !== null) return team ? raw : null
  // Escape hatch for a winner missing from our lists: a raw ESPN id ("4277905"), also matching
  // the "Joueur #4277905" label shown for such ids. Nobody can have picked it, which is fine.
  const byId = raw.match(/^(?:joueur|coach)?\s*#?\s*(\d{1,12})$/i)
  if (byId) return byId[1]
  if (kind === 'coach') return (coachIndex ??= buildIndex(COACHES, 'coach')).get(norm(raw)) ?? null
  // Rookie questions accept any player: the rookie flag in our data may lag behind ESPN.
  return (playerIndex ??= buildIndex(PLAYERS, 'player')).get(norm(raw)) ?? null
}

/**
 * Sets, voids or clears the admin override of one question. FormData fields: questionId,
 * intent ('set' | 'void' | 'auto'), winner (1 or 2 values: co-winners of a shared award).
 */
export async function setResultAction(formData: FormData): Promise<AdminMessage> {
  if (!(await isAdmin())) return { ok: false, message: FORBIDDEN }
  const q = QUESTIONS.find((x) => x.id === formData.get('questionId'))
  if (!q) return { ok: false, message: 'Question inconnue.' }

  const intent = formData.get('intent') ?? 'set'
  let result: QuestionResult | null
  let done: string
  if (intent === 'auto') {
    result = null
    done = `${q.short} : retour au résultat automatique.`
  } else if (intent === 'void') {
    result = { status: 'void' }
    done = `${q.short} : question annulée pour tout le monde.`
  } else if (intent === 'set') {
    const raws = formData
      .getAll('winner')
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
    if (!raws.length) return { ok: false, message: 'Choisis au moins un vainqueur.' }
    if (raws.length > 3) return { ok: false, message: 'Trois vainqueurs maximum.' }
    const winners: string[] = []
    for (const raw of raws) {
      const id = resolveWinner(q.kind, raw)
      if (!id) return { ok: false, message: `« ${raw.slice(0, 60)} » introuvable : choisis un nom dans la liste.` }
      if (!winners.includes(id)) winners.push(id)
    }
    result = { status: 'final', winners, source: 'admin' }
    done = `${q.short} : ${winners.map((id) => answerLabel(q.kind, id)).join(' + ')} enregistré.`
  } else {
    return { ok: false, message: 'Action inconnue.' }
  }

  try {
    await setAdminResult(q.id, result)
  } catch {
    return { ok: false, message: 'Enregistrement impossible : la base de données ne répond pas.' }
  }
  revalidateScores()
  return { ok: true, message: done }
}

// ---------------------------------------------------------------- data refresh

/** Forces a live ESPN read (standings + question results), then drops cached renders. */
export async function refreshScoresAction(): Promise<AdminMessage> {
  if (!(await isAdmin())) return { ok: false, message: FORBIDDEN }
  const problems: string[] = []
  await refreshStandings().catch((err) => problems.push(`classement : ${err instanceof Error ? err.message : err}`))
  // ESPN failures don't reject: each failed source is in the report's `errors`.
  await refreshAutoResults()
    .then((r) => {
      for (const [s, e] of Object.entries(r.errors)) problems.push(`résultats (${s}) : ${e}`)
    })
    .catch((err) => problems.push(`résultats : ${err instanceof Error ? err.message : err}`))
  revalidateScores()
  return problems.length
    ? { ok: false, message: `ESPN n’a pas tout renvoyé (${problems.join(' ; ')}). Le reste est à jour.` }
    : { ok: true, message: 'C’est fait : classement et résultats relus chez ESPN.' }
}
