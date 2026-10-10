// Leaderboard loader. Server-only, and only after the lock: callers check isLocked() first
// (before it, listPredictionsAfterLock throws, and so do these functions).
//
// Scores are never stored: every load recomputes them from the predictions, the odds frozen at
// lock, ESPN standings and question results (spec §7). It is computed once per request (React
// cache) and never cached across requests: ESPN data is already cached in kv (lib/espn.ts), and
// at ~30 players the computation is negligible, so an admin result change shows up immediately.
import { cache } from 'react'
import { NORMALIZED_LINES } from '@/config/bookmaker-lines'
import { isLocked, isRegularSeasonOver } from '@/config/season'
import { pseudoKey } from './auth'
import { getStandings, type StandingsResult } from './espn'
import { getQuestionOdds } from './odds'
import { listPredictionsAfterLock } from './predictions'
import { getResults } from './results'
import { buildLockContext, scoreAll, type LockContext } from './scoring'
import type { Results, ScoreCard, StoredPrediction } from './types'


export interface Leaderboard {
  /** Sorted by general rank (card.rank, 1-based, strict). */
  cards: ScoreCard[]
  standings: StandingsResult
  /** Regular season over: grid scores use real wins, not the projection. */
  final: boolean
  ctx: LockContext
  results: Results
}

export interface PlayerCard {
  card: ScoreCard
  prediction: StoredPrediction
}

interface Board extends Leaderboard {
  preds: StoredPrediction[]
}

const loadBoard = cache(async (): Promise<Board> => {
  const [preds, { odds }, standings, results] = await Promise.all([
    listPredictionsAfterLock(),
    getQuestionOdds(), // last pre-lock snapshot: frozen once the lock has passed
    getStandings(),
    getResults(),
  ])
  const final = isRegularSeasonOver()
  const ctx = buildLockContext(preds, odds)
  // scoreAll ends with leaderboard(): cards come back sorted with their general rank.
  const cards = scoreAll(preds, ctx, standings.teams, NORMALIZED_LINES, results, final)
  return { cards, standings, final, ctx, results, preds }
})

async function board(): Promise<Board> {
  if (!isLocked()) throw new Error('The leaderboard opens at the lock')
  return loadBoard()
}

/** The full board. Throws before the lock. */
export async function getLeaderboard(): Promise<Leaderboard> {
  const { cards, standings, final, ctx, results } = await board()
  return { cards, standings, final, ctx, results }
}

/** One player's card and prediction, by pseudo (case-insensitive). Null if they have none. Throws before the lock. */
export async function getPlayerCard(pseudo: string): Promise<PlayerCard | null> {
  const { cards, preds } = await board()
  const key = pseudoKey(pseudo)
  const prediction = preds.find((p) => pseudoKey(p.pseudo) === key)
  const card = prediction && cards.find((c) => c.userId === prediction.userId)
  return prediction && card ? { card, prediction } : null
}
