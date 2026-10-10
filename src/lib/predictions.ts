// Prediction storage. Server-only. The lock is enforced inside the SQL write itself
// (`where now() < lockAt`), so no code path can save after the first tip-off.
import { SCORING } from '@/config/scoring'
import { lockAt } from '@/config/season'
import { answerLookup } from './data'
import { sql } from './db'
import { getQuestionOdds } from './odds'
import type { Answers, GridPrediction, HotTakes, PredictionDoc, StoredPrediction } from './types'
import {
  answersErrors,
  emptyGrid,
  emptyHotTakes,
  gridStatus,
  questionHotTakeAllowed,
  teamHotTakeAllowed,
} from './validation'

function rowToDoc(row: Record<string, unknown>): PredictionDoc {
  return {
    grid: (row.grid as GridPrediction) ?? emptyGrid(),
    answers: (row.answers as Answers) ?? {},
    hotTakes: (row.hot_takes as HotTakes) ?? emptyHotTakes(),
  }
}

/** The user's own prediction (empty skeleton if they never saved). */
export interface OwnPrediction extends PredictionDoc {
  gridValid: boolean
  lastSavedAt: string | null
  /** Bumped on every save (0 = never saved). Editors send it back to detect a stale tab/device. */
  version: number
}

export async function getOwnPrediction(userId: number): Promise<OwnPrediction> {
  const rows = await sql()`select grid, answers, hot_takes, grid_valid, last_saved_at, version from predictions where user_id = ${userId}`
  if (!rows.length)
    return { grid: emptyGrid(), answers: {}, hotTakes: emptyHotTakes(), gridValid: false, lastSavedAt: null, version: 0 }
  return {
    ...rowToDoc(rows[0]),
    gridValid: rows[0].grid_valid,
    lastSavedAt: new Date(rows[0].last_saved_at).toISOString(),
    version: rows[0].version,
  }
}

/**
 * Everyone's predictions. Refuses before the lock: other players' predictions (and anything
 * derived from them, like the consensus) must stay hidden until the first tip-off.
 */
export async function listPredictionsAfterLock(): Promise<StoredPrediction[]> {
  if (Date.now() < lockAt().getTime()) throw new Error('Predictions are private until the lock')
  const rows = await sql()`
    select p.user_id, u.pseudo, p.grid, p.answers, p.hot_takes, p.grid_valid, p.last_saved_at
    from predictions p join users u on u.id = p.user_id
    order by u.pseudo_key`
  return rows.map((r) => ({
    ...rowToDoc(r),
    userId: r.user_id,
    pseudo: r.pseudo,
    gridValid: r.grid_valid,
    lastSavedAt: new Date(r.last_saved_at).toISOString(),
  }))
}

export type SaveResult =
  | { ok: true; gridValid: boolean; prunedHotTakes: string[]; savedAt: string; version: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; conflict?: boolean }

const LOCKED_ERROR = 'Les pronos sont verrouillés depuis le premier match.'
const CONFLICT_ERROR =
  'Tes pronos ont été modifiés ailleurs (autre onglet ou autre appareil). Recharge la page pour repartir de la dernière version.'

/**
 * Saves any subset of grid / answers / hot takes. The grid may be saved incomplete (draft);
 * grid_valid records whether it passes every blocking rule. Answers must be valid ids.
 * Hot takes that no longer qualify after a grid/answer change (or an odds refresh) are dropped
 * and reported; a hot take the user is adding right now is refused instead.
 *
 * expectedVersion: the version the editor started from. If the stored prediction moved on since
 * (another tab or device saved), the save is refused rather than silently overwriting it.
 */
export async function savePrediction(
  userId: number,
  patch: { grid?: GridPrediction; answers?: Answers; hotTakes?: HotTakes },
  expectedVersion?: number,
): Promise<SaveResult> {
  const lock = lockAt()
  if (Date.now() >= lock.getTime()) return { ok: false, error: LOCKED_ERROR }

  const current = await getOwnPrediction(userId)
  if (expectedVersion !== undefined && expectedVersion !== current.version)
    return { ok: false, error: CONFLICT_ERROR, conflict: true }
  const next: PredictionDoc = {
    grid: patch.grid ?? current.grid,
    answers: patch.answers ?? current.answers,
    hotTakes: patch.hotTakes ?? current.hotTakes,
  }

  if (patch.answers) {
    const errs = answersErrors(next.answers, answerLookup)
    if (Object.keys(errs).length) return { ok: false, error: 'Certaines réponses ne sont pas valides.', fieldErrors: errs }
  }

  // Keep only hot takes that still qualify on the bookmaker side; cap the counts.
  const { odds } = await getQuestionOdds()
  const pruned: string[] = []
  const teams = next.hotTakes.teams.filter((abbr) => {
    const ok = teamHotTakeAllowed(next.grid, abbr)
    if (!ok) pruned.push(abbr)
    return ok
  })
  const questions = next.hotTakes.questions.filter((q) => {
    const ok = questionHotTakeAllowed(q, next.answers[q], odds)
    if (!ok) pruned.push(q)
    return ok
  })
  if (teams.length > SCORING.htMaxTeams || questions.length > SCORING.htMaxQuestions) {
    return {
      ok: false,
      error: `Trop de hot takes : ${SCORING.htMaxTeams} équipes et ${SCORING.htMaxQuestions} questions maximum.`,
    }
  }
  next.hotTakes = { teams, questions }
  // A hot take being added right now that does not qualify is refused; ones already stored that
  // stopped qualifying (grid/answer change, odds refresh) are dropped and reported.
  const had = new Set<string>([...current.hotTakes.teams, ...current.hotTakes.questions])
  const refused = patch.hotTakes ? pruned.filter((id) => !had.has(id)) : []
  if (refused.length) {
    return { ok: false, error: `Hot take refusé (${refused.join(', ')}) : pas assez d’écart avec les bookmakers.` }
  }
  const reported = pruned.filter((id) => had.has(id))

  const gridValid = gridStatus(next.grid).valid
  const rows = await sql()`
    insert into predictions (user_id, grid, answers, hot_takes, grid_valid)
    select ${userId}, ${JSON.stringify(next.grid)}::jsonb, ${JSON.stringify(next.answers)}::jsonb,
           ${JSON.stringify(next.hotTakes)}::jsonb, ${gridValid}
    where now() < ${lock.toISOString()}::timestamptz
    on conflict (user_id) do update set
      grid = excluded.grid, answers = excluded.answers, hot_takes = excluded.hot_takes,
      grid_valid = excluded.grid_valid, last_saved_at = now(), version = predictions.version + 1
    where now() < ${lock.toISOString()}::timestamptz and predictions.version = ${current.version}
    returning last_saved_at, version`
  if (!rows.length) {
    if (Date.now() >= lock.getTime()) return { ok: false, error: LOCKED_ERROR }
    return { ok: false, error: CONFLICT_ERROR, conflict: true } // a concurrent save won the race
  }
  return {
    ok: true,
    gridValid,
    prunedHotTakes: reported,
    savedAt: new Date(rows[0].last_saved_at).toISOString(),
    version: rows[0].version,
  }
}
