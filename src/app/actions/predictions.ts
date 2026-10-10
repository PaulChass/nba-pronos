'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth'
import { savePrediction, type SaveResult } from '@/lib/predictions'
import { parseAnswers, parseGrid, parseHotTakes } from '@/lib/validation'

const notSignedIn: SaveResult = { ok: false, error: 'Session expirée : reconnecte-toi.' }

/** Saves the grid (drafts allowed). Returns whether it is complete and valid. */
export async function saveGridAction(input: unknown): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const grid = parseGrid(input)
  if (!grid) return { ok: false, error: 'Grille illisible.' }
  const res = await savePrediction(user.id, { grid })
  if (res.ok) revalidatePath('/recap')
  return res
}

export async function saveAnswersAction(input: unknown): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const answers = parseAnswers(input)
  if (!answers) return { ok: false, error: 'Réponses illisibles.' }
  const res = await savePrediction(user.id, { answers })
  if (res.ok) revalidatePath('/recap')
  return res
}

export async function saveHotTakesAction(input: unknown): Promise<SaveResult> {
  const user = await getCurrentUser()
  if (!user) return notSignedIn
  const hotTakes = parseHotTakes(input)
  if (!hotTakes) return { ok: false, error: 'Hot takes illisibles.' }
  const res = await savePrediction(user.id, { hotTakes })
  if (res.ok) revalidatePath('/recap')
  return res
}
