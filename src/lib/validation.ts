// Grid / answers / hot-take rules shared by the browser (live feedback) and the server
// (authoritative check before saving). Pure module: no Next, no DB, no JSON imports.

import { NORMALIZED_LINES } from '../config/bookmaker-lines.ts'
import { QUESTION_BY_ID, QUESTIONS } from '../config/questions.ts'
import { SCORING } from '../config/scoring.ts'
import { SEASON } from '../config/season.ts'
import { TEAMS } from '../data/teams.ts'
import type {
  Answers,
  AnswerKind,
  Conf,
  GridPrediction,
  HotTakes,
  QuestionId,
  QuestionOdds,
  TeamAbbr,
} from './types.ts'

export const CONFS: readonly Conf[] = ['E', 'W']
export const TEAMS_BY_CONF: Record<Conf, TeamAbbr[]> = {
  E: TEAMS.filter((t) => t.conference === 'E').map((t) => t.abbr),
  W: TEAMS.filter((t) => t.conference === 'W').map((t) => t.abbr),
}
const ALL_ABBRS = new Set(TEAMS.map((t) => t.abbr))

/** Fresh empty grid: teams in alphabetical order (by full name), no wins. */
export function emptyGrid(): GridPrediction {
  return {
    order: { E: [...TEAMS_BY_CONF.E], W: [...TEAMS_BY_CONF.W] },
    wins: Object.fromEntries(TEAMS.map((t) => [t.abbr, null])),
  }
}

export function emptyHotTakes(): HotTakes {
  return { teams: [], questions: [] }
}

/**
 * Coerces untrusted input into a well-formed grid, or null if its shape is wrong (unknown teams,
 * an order that is not a permutation of the conference). Value rules are checked by gridStatus.
 */
export function parseGrid(input: unknown): GridPrediction | null {
  if (!input || typeof input !== 'object') return null
  const { order, wins } = input as { order?: unknown; wins?: unknown }
  if (!order || typeof order !== 'object' || !wins || typeof wins !== 'object') return null
  const out: GridPrediction = { order: { E: [], W: [] }, wins: {} }
  for (const conf of CONFS) {
    const list = (order as Record<string, unknown>)[conf]
    if (!Array.isArray(list) || list.length !== 15) return null
    const expected = new Set(TEAMS_BY_CONF[conf])
    const seen = new Set<string>()
    for (const abbr of list) {
      if (typeof abbr !== 'string' || !expected.has(abbr) || seen.has(abbr)) return null
      seen.add(abbr)
    }
    out.order[conf] = list as TeamAbbr[]
  }
  for (const abbr of ALL_ABBRS) {
    const v = (wins as Record<string, unknown>)[abbr]
    if (v === null || v === undefined || v === '') out.wins[abbr] = null
    else if (typeof v === 'number' && Number.isInteger(v)) out.wins[abbr] = v
    else return null
  }
  return out
}

export interface GridStatus {
  valid: boolean
  /** Sum of the wins filled so far. */
  total: number
  /** How many of the 30 teams have a wins value. */
  filled: number
  /** total - 1230 (positive = too many wins). Only meaningful once all 30 are filled. */
  delta: number
  /** Blocking problems, in French, ready to display. */
  errors: string[]
  /** Teams whose wins exceed the team ranked just above them in the user's order. */
  orderViolations: TeamAbbr[]
  /** Teams outside 0..82. */
  outOfRange: TeamAbbr[]
  /** Non-blocking warnings (extreme values), by team. */
  warnings: Partial<Record<TeamAbbr, string>>
}

export function gridStatus(grid: GridPrediction): GridStatus {
  let total = 0
  let filled = 0
  const outOfRange: TeamAbbr[] = []
  const orderViolations: TeamAbbr[] = []
  const warnings: Partial<Record<TeamAbbr, string>> = {}

  for (const abbr of ALL_ABBRS) {
    const w = grid.wins[abbr]
    if (w === null || w === undefined) continue
    filled++
    total += w
    if (!Number.isInteger(w) || w < 0 || w > SEASON.gamesPerTeam) outOfRange.push(abbr)
    else if (w > SCORING.warnHighWins) warnings[abbr] = `${w} victoires : ce serait historique`
    else if (w < SCORING.warnLowWins) warnings[abbr] = `${w} victoires : ce serait historique`
  }
  for (const conf of CONFS) {
    const order = grid.order[conf]
    for (let i = 1; i < order.length; i++) {
      const above = grid.wins[order[i - 1]]
      const here = grid.wins[order[i]]
      if (above !== null && here !== null && here > above) orderViolations.push(order[i])
    }
  }

  const errors: string[] = []
  if (filled < 30) errors.push(`Il reste ${30 - filled} équipe${30 - filled > 1 ? 's' : ''} sans nombre de victoires.`)
  if (outOfRange.length) errors.push(`Chaque équipe doit avoir entre 0 et ${SEASON.gamesPerTeam} victoires.`)
  if (orderViolations.length)
    errors.push('Une équipe ne peut pas avoir plus de victoires que celle classée juste au-dessus.')
  const delta = total - SEASON.totalWins
  if (filled === 30 && delta !== 0)
    errors.push(
      delta > 0
        ? `Total de ${total} victoires : ${delta} de trop (il en faut exactement ${SEASON.totalWins}).`
        : `Total de ${total} victoires : il en manque ${-delta} (il en faut exactement ${SEASON.totalWins}).`,
    )

  return {
    valid: errors.length === 0,
    total,
    filled,
    delta,
    errors,
    orderViolations,
    outOfRange,
    warnings,
  }
}

/**
 * "Équilibrer": rescales every team proportionally so the league total is exactly 1230, keeping
 * the user's order (non-increasing wins stay non-increasing). Returns null when it cannot
 * (missing values, all zeros, or a team would leave 0..82).
 */
export function balanceGrid(grid: GridPrediction): GridPrediction | null {
  const abbrs = [...CONFS.flatMap((c) => grid.order[c])]
  const values = abbrs.map((a) => grid.wins[a])
  if (values.some((v) => v === null)) return null
  const total = (values as number[]).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const factor = SEASON.totalWins / total
  const rankOf = (a: TeamAbbr) => {
    for (const c of CONFS) {
      const i = grid.order[c].indexOf(a)
      if (i >= 0) return i
    }
    return 99
  }
  const scaled = abbrs.map((a) => {
    const exact = (grid.wins[a] as number) * factor
    return { a, floor: Math.floor(exact), frac: exact - Math.floor(exact), rank: rankOf(a) }
  })
  let remainder = SEASON.totalWins - scaled.reduce((s, x) => s + x.floor, 0)
  // Largest remainder first; equal values tie-break on the better rank so order is preserved.
  const byPriority = [...scaled].sort((x, y) => y.frac - x.frac || x.rank - y.rank)
  for (const x of byPriority) {
    if (remainder <= 0) break
    x.floor++
    remainder--
  }
  if (scaled.some((x) => x.floor < 0 || x.floor > SEASON.gamesPerTeam)) return null
  const wins = { ...grid.wins }
  for (const x of scaled) wins[x.a] = x.floor
  const balanced: GridPrediction = { order: grid.order, wins }
  return gridStatus(balanced).orderViolations.length ? null : balanced
}

/** User's predicted conference rank (1..15) for a team. */
export function predictedRank(grid: GridPrediction, abbr: TeamAbbr): number {
  for (const c of CONFS) {
    const i = grid.order[c].indexOf(abbr)
    if (i >= 0) return i + 1
  }
  return 0
}

// ---------------------------------------------------------------- answers

/** Looks up whether `id` is a valid answer for a kind (players/coaches lists live server-side). */
export type AnswerLookup = (kind: AnswerKind, id: string) => boolean

export function teamAnswerValid(kind: AnswerKind, id: string): boolean | null {
  if (kind === 'team' || kind === 'champion') return ALL_ABBRS.has(id)
  if (kind === 'teamE') return TEAMS_BY_CONF.E.includes(id)
  if (kind === 'teamW') return TEAMS_BY_CONF.W.includes(id)
  return null // not a team kind
}

/** Drops unknown question ids and non-string values. Ids themselves are checked by answersErrors. */
export function parseAnswers(input: unknown): Answers | null {
  if (!input || typeof input !== 'object') return null
  const out: Answers = {}
  for (const q of QUESTIONS) {
    const v = (input as Record<string, unknown>)[q.id]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || v.length > 40) return null
    out[q.id] = v
  }
  return out
}

/** Blocking problems with the answers, keyed by question. Unanswered questions are not errors. */
export function answersErrors(answers: Answers, lookup: AnswerLookup): Partial<Record<QuestionId, string>> {
  const errors: Partial<Record<QuestionId, string>> = {}
  for (const q of QUESTIONS) {
    const id = answers[q.id]
    if (!id) continue
    const teamOk = teamAnswerValid(q.kind, id)
    const ok = teamOk ?? lookup(q.kind, id)
    if (!ok) errors[q.id] = 'Réponse inconnue.'
  }
  const champ = answers.champion
  if (champ && !errors.champion && champ !== answers.finalistE && champ !== answers.finalistW)
    errors.champion = 'Ton champion doit être l’un de tes deux finalistes.'
  return errors
}

// ---------------------------------------------------------------- hot takes

/** Bookmaker half of the team hot-take test (the group half is checked at lock). */
export function teamHotTakeAllowed(grid: GridPrediction, abbr: TeamAbbr): boolean {
  const w = grid.wins[abbr]
  const line = NORMALIZED_LINES[abbr]
  return w !== null && w !== undefined && line !== undefined && Math.abs(w - line) >= SCORING.htTeamMinGap
}

/**
 * Odds half of the question hot-take test: the pick must be at least `htOddsRatio` times less
 * likely than the market favourite. Questions without a market (`odds[q]` missing) pass here;
 * at lock they need a pick nobody else made.
 */
export function questionHotTakeAllowed(q: QuestionId, pick: string | undefined, odds: QuestionOdds): boolean {
  if (!pick) return false
  const market = odds[q]
  if (!market || Object.keys(market).length === 0) return true
  const probs = Object.values(market)
  const fav = Math.max(...probs)
  const p = market[pick] ?? Math.min(...probs) // unlisted picks count as the longest shot
  return p <= fav / SCORING.htOddsRatio
}

export function parseHotTakes(input: unknown): HotTakes | null {
  if (!input || typeof input !== 'object') return null
  const { teams, questions } = input as { teams?: unknown; questions?: unknown }
  if (!Array.isArray(teams) || !Array.isArray(questions)) return null
  if (!teams.every((t) => typeof t === 'string' && ALL_ABBRS.has(t))) return null
  if (!questions.every((q) => typeof q === 'string' && q in QUESTION_BY_ID)) return null
  return { teams: [...new Set(teams as string[])], questions: [...new Set(questions as QuestionId[])] }
}

/** Blocking problems with the declared hot takes. */
export function hotTakesErrors(ht: HotTakes, grid: GridPrediction, answers: Answers, odds: QuestionOdds): string[] {
  const errors: string[] = []
  if (ht.teams.length > SCORING.htMaxTeams) errors.push(`${SCORING.htMaxTeams} hot takes équipes maximum.`)
  if (ht.questions.length > SCORING.htMaxQuestions)
    errors.push(`${SCORING.htMaxQuestions} hot takes questions maximum.`)
  for (const abbr of ht.teams)
    if (!teamHotTakeAllowed(grid, abbr))
      errors.push(`${abbr} : il faut au moins ${SCORING.htTeamMinGap} victoires d’écart avec les bookmakers.`)
  for (const q of ht.questions)
    if (!questionHotTakeAllowed(q, answers[q], odds))
      errors.push(`${QUESTION_BY_ID[q].short} : ce choix n’est pas assez audacieux selon les bookmakers.`)
  return errors
}
