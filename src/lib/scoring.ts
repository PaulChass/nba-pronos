// Scoring engine, barème 2026.1 (spec §5). Pure: no I/O, no clock, no randomness, so a score can
// be replayed from (predictions, lock context, standings, results) at any time.
// Imports only types/config with relative `.ts` paths so `node --test` can run it.
import { NORMALIZED_LINES } from '../config/bookmaker-lines.ts'
import { QUESTIONS } from '../config/questions.ts'
import { SCORING } from '../config/scoring.ts'
import { SEASON } from '../config/season.ts'
import { TEAMS } from '../data/teams.ts'
import type {
  Conf,
  QuestionHotTake,
  QuestionId,
  QuestionOdds,
  QuestionResult,
  QuestionScore,
  Results,
  ScoreCard,
  StoredPrediction,
  TeamAbbr,
  TeamHotTake,
  TeamScore,
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

const CONFS: readonly Conf[] = ['E', 'W']
const CONF_OF: Record<TeamAbbr, Conf> = Object.fromEntries(TEAMS.map((t) => [t.abbr, t.conference]))
const TEAMS_BY_CONF: Record<Conf, TeamAbbr[]> = {
  E: TEAMS.filter((t) => t.conference === 'E').map((t) => t.abbr),
  W: TEAMS.filter((t) => t.conference === 'W').map((t) => t.abbr),
}
const QUESTION_IDS = new Set<string>(QUESTIONS.map((q) => q.id))

/** 25 per team x 30 teams. */
export const GRID_MAX_POINTS = TEAMS.length * (SCORING.winBase + SCORING.rankExact)
/** Every team hot take won, plus the two most valuable questions doubled. */
export const HOT_TAKES_MAX_POINTS =
  SCORING.htMaxTeams * SCORING.htTeamBonus +
  [...QUESTIONS]
    .map((q) => q.points)
    .sort((a, b) => b - a)
    .slice(0, SCORING.htMaxQuestions)
    .reduce((a, b) => a + b, 0)

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---------------------------------------------------------------- lock context

export function buildLockContext(preds: StoredPrediction[], odds: QuestionOdds): LockContext {
  // Only complete, valid grids represent a real opinion: invalid ones never feed the median.
  const valid = preds.filter((p) => p.gridValid)
  const medianOthers: LockContext['medianOthers'] = {}
  for (const p of preds) {
    const others = valid.filter((o) => o.userId !== p.userId)
    const perTeam: Record<TeamAbbr, number | null> = {}
    for (const t of TEAMS) {
      const wins = others.map((o) => o.grid.wins[t.abbr]).filter((w): w is number => typeof w === 'number')
      perTeam[t.abbr] = wins.length >= SCORING.htGroupMinOthers ? median(wins) : null
    }
    medianOthers[p.userId] = perTeam
  }

  const pickCounts: LockContext['pickCounts'] = {}
  const answeredCounts: LockContext['answeredCounts'] = {}
  for (const q of QUESTIONS) {
    const counts: Record<string, number> = {}
    let answered = 0
    for (const p of preds) {
      const pick = p.answers?.[q.id]
      if (!pick) continue
      answered++
      counts[pick] = (counts[pick] ?? 0) + 1
    }
    pickCounts[q.id] = counts
    answeredCounts[q.id] = answered
  }

  return { nGridPlayers: valid.length, medianOthers, pickCounts, answeredCounts, odds }
}

// ---------------------------------------------------------------- reality

/** proj = round(W + (82-GP) * (W + K*L'/82) / (GP + K)); equals the real total at 82 games. */
export function projectWins(s: TeamStanding, line: number): number {
  const G = SEASON.gamesPerTeam
  const K = SCORING.projectionK
  const gp = s.w + s.l
  const left = Math.max(0, G - gp)
  // The line acts as K games already played at the bookmakers' pace; its weight fades as GP grows.
  return Math.round(s.w + (left * (s.w + (K * line) / G)) / (gp + K))
}

/**
 * Wins used for scoring: projected during the season, real once the regular season is over.
 * Teams missing from the standings (feed hiccup, before opening night) are projected from 0-0,
 * i.e. they sit on their line.
 */
export function actualWins(
  standings: TeamStanding[],
  lines: Record<TeamAbbr, number>,
  final: boolean,
): Record<TeamAbbr, number> {
  const byAbbr = new Map(standings.map((s) => [s.abbr, s]))
  const out: Record<TeamAbbr, number> = {}
  for (const t of TEAMS) {
    const s = byAbbr.get(t.abbr) ?? { abbr: t.abbr, conference: t.conference, w: 0, l: 0 }
    const line = lines[t.abbr] ?? NORMALIZED_LINES[t.abbr] ?? SEASON.totalWins / TEAMS.length
    out[t.abbr] = final ? s.w : projectWins(s, line)
  }
  return out
}

/** Per conference: lo = 1 + #teams with more wins, hi = #teams with at least as many wins. */
export function rankRanges(wins: Record<TeamAbbr, number>): Record<TeamAbbr, [number, number]> {
  const out: Record<TeamAbbr, [number, number]> = {}
  for (const conf of CONFS) {
    const abbrs = TEAMS_BY_CONF[conf].filter((a) => typeof wins[a] === 'number')
    for (const a of abbrs) {
      const w = wins[a]
      let more = 0
      let atLeast = 0
      for (const b of abbrs) {
        if (wins[b] > w) more++
        if (wins[b] >= w) atLeast++
      }
      out[a] = [more + 1, atLeast]
    }
  }
  return out
}

// ---------------------------------------------------------------- building blocks

/** Points for one team: wins part + rank part (benefit of the doubt inside a tied range). */
export function teamPoints(
  predictedWins: number,
  predictedRank: number,
  actual: number,
  range: [number, number],
): { winPts: number; rankPts: number } {
  const winPts = Math.max(0, SCORING.winBase - Math.abs(predictedWins - actual))
  const [lo, hi] = range
  const r = predictedRank
  const rankPts = r >= lo && r <= hi ? SCORING.rankExact : r >= lo - 1 && r <= hi + 1 ? SCORING.rankNear : 0
  return { winPts, rankPts }
}

/**
 * Team hot take. P = predicted wins, L = normalized line, M = median of the other valid grids
 * (null = fewer than htGroupMinOthers others: group test skipped), A = actual/projected wins.
 */
export function teamHotTakeOutcome(P: number, L: number, M: number | null, A: number): TeamHotTake {
  const gap = SCORING.htTeamMinGap
  const dir = Math.sign(P - L)
  const eligible = Math.abs(P - L) >= gap && (M === null || dir * (P - M) >= gap)
  const e = Math.abs(P - A)
  const success = eligible && e < Math.abs(L - A) && (M === null || e < Math.abs(M - A))
  return { eligible, success, bonus: success ? SCORING.htTeamBonus : 0 }
}

/**
 * Question hot take qualification (at lock). With a market: the pick must be htOddsRatio times
 * less likely than the favourite (unlisted pick = the longest listed shot) and shared by at most
 * floor((N-1)/htGroupShareDivisor) others. Without a market: nobody else, and enough others.
 */
export function questionHotTakeEligible(q: QuestionId, pick: string | null | undefined, ctx: LockContext): boolean {
  if (!pick) return false
  const n = ctx.answeredCounts[q] ?? 0
  const others = Math.max(0, (ctx.pickCounts[q]?.[pick] ?? 0) - 1)
  const market = ctx.odds[q]
  const probs = market ? Object.values(market) : []
  if (market && probs.length) {
    const fav = Math.max(...probs)
    const p = market[pick] ?? Math.min(...probs)
    return p <= fav / SCORING.htOddsRatio && others <= Math.floor((n - 1) / SCORING.htGroupShareDivisor)
  }
  return others === 0 && n - 1 >= SCORING.htGroupMinOthers
}

/** Declared hot takes actually considered: known ids, de-duplicated, capped in stored order. */
export function declaredHotTakes(pred: Pick<StoredPrediction, 'hotTakes'>): { teams: TeamAbbr[]; questions: QuestionId[] } {
  const ht = pred.hotTakes ?? { teams: [], questions: [] }
  const teams = [...new Set((ht.teams ?? []).filter((a) => a in CONF_OF))].slice(0, SCORING.htMaxTeams)
  const questions = [...new Set((ht.questions ?? []).filter((q) => QUESTION_IDS.has(q)))].slice(
    0,
    SCORING.htMaxQuestions,
  )
  return { teams, questions }
}

/** Fixed-template caption, e.g. "Spurs à 70 V : +11 sur Vegas, +12 sur le groupe". */
export function teamHotTakeCaption(teamName: string, P: number, L: number, M: number | null): string {
  const signed = (x: number) => {
    const n = Math.round(x)
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'
  }
  const group = M === null ? '' : `, ${signed(P - M)} sur le groupe`
  return `${teamName} à ${P} V : ${signed(P - L)} sur Vegas${group}`
}

// ---------------------------------------------------------------- per user

export function scoreUser(
  pred: StoredPrediction,
  ctx: LockContext,
  actual: Record<TeamAbbr, number>,
  results: Results,
  /** Normalized lines L' (sum 1230). Defaults to the season config. */
  lines: Record<TeamAbbr, number> = NORMALIZED_LINES,
): ScoreCard {
  const ranges = rankRanges(actual)
  const declared = declaredHotTakes(pred)
  const htTeams = new Set(declared.teams)
  const htQuestions = new Set<QuestionId>(declared.questions)
  const valid = pred.gridValid
  const medians = ctx.medianOthers[pred.userId] ?? {}

  // ---- grid: an invalid grid is still listed (for display) but earns nothing
  const teams: TeamScore[] = []
  for (const conf of CONFS) {
    const order = pred.grid?.order?.[conf]?.length ? pred.grid.order[conf] : TEAMS_BY_CONF[conf]
    order.forEach((abbr, i) => {
      const P = pred.grid?.wins?.[abbr] ?? 0
      const r = i + 1
      const A = actual[abbr] ?? 0
      const range = ranges[abbr] ?? [0, 0]
      const L = lines[abbr] ?? NORMALIZED_LINES[abbr] ?? 0
      const pts = valid ? teamPoints(P, r, A, range) : { winPts: 0, rankPts: 0 }
      let hotTake: TeamHotTake | null = null
      if (htTeams.has(abbr)) {
        hotTake = valid
          ? teamHotTakeOutcome(P, L, medians[abbr] ?? null, A)
          : { eligible: false, success: false, bonus: 0 }
      }
      teams.push({
        abbr,
        conference: conf,
        predictedWins: P,
        predictedRank: r,
        actualWins: A,
        actualRank: range,
        line: L,
        winPts: pts.winPts,
        rankPts: pts.rankPts,
        hotTake,
      })
    })
  }

  // ---- questions
  let stillPlayable = 0
  const qs: QuestionScore[] = QUESTIONS.map((q) => {
    const pick = pred.answers?.[q.id] || null
    const result: QuestionResult = results[q.id] ?? { status: 'pending' }
    const eligible = htQuestions.has(q.id) ? questionHotTakeEligible(q.id, pick, ctx) : false
    const correct = result.status === 'final' && pick ? result.winners.includes(pick) : null
    const points = correct ? q.points : 0
    const hotTake: QuestionHotTake | null = htQuestions.has(q.id)
      ? { eligible, success: eligible && correct === true, bonus: eligible && correct === true ? q.points : 0 }
      : null
    // Only an answered, undecided question can still pay (plus its doubling if the 🔥 was retained).
    if (result.status === 'pending' && pick) stillPlayable += q.points + (eligible ? q.points : 0)
    return {
      id: q.id,
      pick,
      status: result.status,
      correct,
      points,
      maxPoints: result.status === 'void' ? 0 : q.points,
      hotTake,
    }
  })

  const grid = teams.reduce((s, t) => s + t.winPts + t.rankPts, 0)
  const questions = qs.reduce((s, q) => s + q.points, 0)
  const hotTakes =
    teams.reduce((s, t) => s + (t.hotTake?.bonus ?? 0), 0) + qs.reduce((s, q) => s + (q.hotTake?.bonus ?? 0), 0)

  return {
    userId: pred.userId,
    pseudo: pred.pseudo,
    gridValid: valid,
    lastSavedAt: pred.lastSavedAt,
    grid,
    questions,
    hotTakes,
    total: grid + questions + hotTakes,
    teams,
    qs,
    stillPlayable,
    rank: 0, // assigned by leaderboard()
  }
}

// ---------------------------------------------------------------- leaderboard

/** Sorts by total desc, grid desc, lastSavedAt asc, pseudo; assigns `rank` (1-based). */
export function leaderboard(cards: ScoreCard[]): ScoreCard[] {
  const time = (iso: string) => {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  return [...cards]
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.grid - a.grid ||
        time(a.lastSavedAt) - time(b.lastSavedAt) ||
        a.pseudo.localeCompare(b.pseudo, 'fr'),
    )
    .map((c, i) => ({ ...c, rank: i + 1 }))
}

/** Convenience: full pipeline for every prediction. */
export function scoreAll(
  preds: StoredPrediction[],
  ctx: LockContext,
  standings: TeamStanding[],
  lines: Record<TeamAbbr, number>,
  results: Results,
  final: boolean,
): ScoreCard[] {
  const actual = actualWins(standings, lines, final)
  return leaderboard(preds.map((p) => scoreUser(p, ctx, actual, results, lines)))
}
