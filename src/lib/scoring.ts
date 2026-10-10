// Scoring engine — CONTRACT STUB. Implemented by the scoring workstream.
// Pure module: imports only types/config with relative `.ts` paths so `node --test` can run it.
import type {
  QuestionOdds,
  QuestionId,
  Results,
  ScoreCard,
  StoredPrediction,
  TeamAbbr,
  TeamStanding,
} from './types.ts'

/** Everything frozen at lock that the hot-take tests need. Plain JSON (cacheable). */
export interface LockContext {
  /** Players with a valid grid (grid hot takes) — count. */
  nGridPlayers: number
  /** Per user, per team: median of the OTHER valid grids' wins; null if < htGroupMinOthers others. */
  medianOthers: Record<number, Record<TeamAbbr, number | null>>
  /** Per question: answer id -> number of players who picked it (the user included). */
  pickCounts: Partial<Record<QuestionId, Record<string, number>>>
  /** Per question: number of players who answered it. */
  answeredCounts: Partial<Record<QuestionId, number>>
  odds: QuestionOdds
}

export function buildLockContext(_preds: StoredPrediction[], _odds: QuestionOdds): LockContext {
  throw new Error('not implemented')
}

/** proj = round(W + (82-GP) * (W + K*L'/82) / (GP + K)); equals the real total at 82 games. */
export function projectWins(_s: TeamStanding, _line: number): number {
  throw new Error('not implemented')
}

/** Wins used for scoring: projected during the season, real once the regular season is over. */
export function actualWins(
  _standings: TeamStanding[],
  _lines: Record<TeamAbbr, number>,
  _final: boolean,
): Record<TeamAbbr, number> {
  throw new Error('not implemented')
}

/** Per conference: lo = 1 + #teams with more wins, hi = #teams with at least as many wins. */
export function rankRanges(_wins: Record<TeamAbbr, number>): Record<TeamAbbr, [number, number]> {
  throw new Error('not implemented')
}

export function scoreUser(
  _pred: StoredPrediction,
  _ctx: LockContext,
  _actual: Record<TeamAbbr, number>,
  _results: Results,
): ScoreCard {
  throw new Error('not implemented')
}

/** Sorts by total desc, grid desc, lastSavedAt asc, pseudo; assigns `rank` (1-based). */
export function leaderboard(_cards: ScoreCard[]): ScoreCard[] {
  throw new Error('not implemented')
}

/** Convenience: full pipeline for every prediction. */
export function scoreAll(
  _preds: StoredPrediction[],
  _ctx: LockContext,
  _standings: TeamStanding[],
  _lines: Record<TeamAbbr, number>,
  _results: Results,
  _final: boolean,
): ScoreCard[] {
  throw new Error('not implemented')
}
