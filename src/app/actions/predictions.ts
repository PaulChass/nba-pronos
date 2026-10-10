'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { getOwnPrediction, savePrediction, type SaveResult } from '@/lib/predictions'
import { parseAnswers, parseGrid, parseHotTakes } from '@/lib/validation'

const notSignedIn: SaveResult = { ok: false, error: 'Session expirée : reconnecte-toi.' }

/** Untrusted version from the client: only a non-negative integer is meaningful. */
const version = (v: unknown): number | undefined =>
  Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined

/** Saves the grid (drafts allowed). Returns whether it is complete and valid. */
export async function saveGridAction(input: unknown, expectedVersion?: number): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const grid = parseGrid(input)
  if (!grid) return { ok: false, error: 'Grille illisible.' }
  const res = await savePrediction(user.id, { grid }, version(expectedVersion))
  if (res.ok) revalidatePath('/recap')
  return res
}

export async function saveAnswersAction(input: unknown, expectedVersion?: number): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const answers = parseAnswers(input)
  if (!answers) return { ok: false, error: 'Réponses illisibles.' }
  const res = await savePrediction(user.id, { answers }, version(expectedVersion))
  if (res.ok) revalidatePath('/recap')
  return res
}

/**
 * Saves the team and/or question hot takes. A missing side keeps what is stored, so the grid page
 * (teams) and the questions page (questions) never overwrite each other.
 */
export async function saveHotTakesAction(
  input: { teams?: unknown; questions?: unknown },
  expectedVersion?: number,
): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const stored = (await getOwnPrediction(user.id)).hotTakes
  const hotTakes = parseHotTakes({
    teams: input?.teams ?? stored.teams,
    questions: input?.questions ?? stored.questions,
  })
  if (!hotTakes) return { ok: false, error: 'Hot takes illisibles.' }
  const res = await savePrediction(user.id, { hotTakes }, version(expectedVersion))
  if (res.ok) revalidatePath('/recap')
  return res
}
