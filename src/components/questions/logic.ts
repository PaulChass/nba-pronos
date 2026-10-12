// Pure helpers for the questions page: option search, side effects of a pick, hot-take state.
// Shared by the client components and node tests (relative .ts imports, no JSON, no React).
import { QUESTIONS } from '../../config/questions.ts'
import { SCORING } from '../../config/scoring.ts'
import { TEAMS } from '../../data/teams.ts'
import type { PickerOption } from '../../lib/data.ts'
import type { AnswerKind, Answers, QuestionId, QuestionOdds, Team, TeamAbbr } from '../../lib/types.ts'
import { questionHotTakeAllowed } from '../../lib/validation.ts'

export const TEAM: Record<TeamAbbr, Team> = Object.fromEntries(TEAMS.map((t) => [t.abbr, t]))

/** Search listboxes never render more than this many options (610 players otherwise). */
export const MAX_MATCHES = 50

/** Lowercase, accents stripped, punctuation collapsed to single spaces: "Dončić" -> "doncic". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Team behind an option: a player's or coach's team, or the team itself. */
export function optionTeam(kind: AnswerKind, opt: PickerOption): Team | null {
  if (kind === 'player' || kind === 'rookie') return TEAM[opt.sub.split(' · ')[0]] ?? null
  // Coach options carry the team's full name (or its tricode when unknown).
  if (kind === 'coach') return TEAMS.find((t) => t.name === opt.sub) ?? TEAM[opt.sub] ?? null
  return TEAM[opt.id] ?? null
}

export interface SearchEntry {
  opt: PickerOption
  team: Team | null
  name: string // normalized label
  nameSquashed: string // without spaces: "deaaron" finds "De'Aaron Fox"
  hay: string // label + sub + team names, normalized
}

/** Precomputes normalized search keys; entries come back sorted alphabetically. */
export function buildIndex(kind: AnswerKind, options: readonly PickerOption[]): SearchEntry[] {
  return options
    .map((opt) => {
      const team = optionTeam(kind, opt)
      const name = normalize(opt.label)
      const hay = normalize([opt.label, opt.sub, team?.name, team?.shortName, team?.abbr].filter(Boolean).join(' '))
      return { opt, team, name, nameSquashed: name.replace(/ /g, ''), hay }
    })
    .sort((a, b) => a.opt.label.localeCompare(b.opt.label, 'fr'))
}

/** Lower is better; -1 = no match. Name prefixes beat inner matches, which beat team matches. */
function matchScore(e: SearchEntry, q: string, tokens: string[], squashed: string): number {
  const inName = e.nameSquashed.includes(squashed)
  if (!inName && !tokens.every((t) => e.hay.includes(t))) return -1
  if (e.name.startsWith(q)) return 0
  const words = e.name.split(' ')
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 1
  if (inName || tokens.every((t) => e.name.includes(t))) return 2
  return 3
}

/**
 * Accent/case-insensitive search on names and teams. An empty query lists everything
 * alphabetically, with the `prefer`red teams first (e.g. the champion's roster for Finals MVP).
 */
export function search(
  index: readonly SearchEntry[],
  query: string,
  opts: { limit?: number; prefer?: readonly TeamAbbr[] } = {},
): { matches: SearchEntry[]; total: number } {
  const limit = opts.limit ?? MAX_MATCHES
  const q = normalize(query)
  if (!q) {
    const prefer = new Set(opts.prefer ?? [])
    const isPreferred = (e: SearchEntry) => (e.team && prefer.has(e.team.abbr) ? 0 : 1)
    const sorted = prefer.size ? [...index].sort((a, b) => isPreferred(a) - isPreferred(b)) : index
    return { matches: sorted.slice(0, limit), total: index.length }
  }
  const tokens = q.split(' ')
  const squashed = q.replace(/ /g, '')
  const hits: { e: SearchEntry; s: number }[] = []
  for (const e of index) {
    const s = matchScore(e, q, tokens, squashed)
    if (s >= 0) hits.push({ e, s })
  }
  hits.sort((a, b) => a.s - b.s) // stable: alphabetical within a tier
  return { matches: hits.slice(0, limit).map((h) => h.e), total: hits.length }
}

// ---------------------------------------------------------------- picks & hot takes

export function answeredCount(answers: Answers): number {
  return QUESTIONS.filter((q) => answers[q.id]).length
}

export interface PickOutcome {
  answers: Answers
  hotQuestions: QuestionId[]
  /** The champion was dropped because it is no longer one of the two finalists. */
  clearedChampion: boolean
  /** Question hot takes dropped because their pick no longer qualifies. */
  droppedHot: QuestionId[]
}

/**
 * Applies a pick (null = clear) and its knock-on effects: the champion must stay one of the two
 * finalists, and a 🔥 only survives while its pick is still a long shot for the bookmakers.
 */
export function applyPick(
  answers: Answers,
  hotQuestions: readonly QuestionId[],
  q: QuestionId,
  pick: string | null,
  odds: QuestionOdds,
): PickOutcome {
  const next: Answers = { ...answers }
  if (pick) next[q] = pick
  else delete next[q]
  let clearedChampion = false
  if (next.champion && next.champion !== next.finalistE && next.champion !== next.finalistW) {
    delete next.champion
    clearedChampion = true
  }
  const kept = hotQuestions.filter((h) => questionHotTakeAllowed(h, next[h], odds))
  return {
    answers: next,
    hotQuestions: kept,
    clearedChampion,
    droppedHot: hotQuestions.filter((h) => !kept.includes(h)),
  }
}

/** Declared 🔥 whose pick no longer qualifies (e.g. stored before an odds refresh). */
export function staleHotTakes(
  hotQuestions: readonly QuestionId[],
  answers: Answers,
  odds: QuestionOdds,
): QuestionId[] {
  return hotQuestions.filter((h) => !questionHotTakeAllowed(h, answers[h], odds))
}

/**
 * The server refused a hot-take list (`sent`): it only refuses 🔥 that were not already stored
 * (`accepted`), so those are switched back off. Removals the user made are kept.
 */
export function rollbackRefusedHot(
  current: readonly QuestionId[],
  sent: readonly QuestionId[],
  accepted: readonly QuestionId[],
): { next: QuestionId[]; rolledBack: QuestionId[] } {
  const rolledBack = sent.filter((h) => !accepted.includes(h))
  return { next: current.filter((h) => !rolledBack.includes(h)), rolledBack }
}

/** Same ids, order ignored. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

export function hasMarket(q: QuestionId, odds: QuestionOdds): boolean {
  const market = odds[q]
  return !!market && Object.keys(market).length > 0
}

export interface HotTakeState {
  on: boolean
  /** The toggle can be pressed (always true while on, so it can be switched off). */
  enabled: boolean
  /** Why it cannot be switched on, in French. */
  reason: string | null
  noMarket: boolean
}

export function hotTakeState(
  q: QuestionId,
  answers: Answers,
  hotQuestions: readonly QuestionId[],
  odds: QuestionOdds,
): HotTakeState {
  const on = hotQuestions.includes(q)
  const noMarket = !hasMarket(q, odds)
  let reason: string | null = null
  if (!on) {
    if (noMarket) reason = 'Pas de cote des bookmakers pour cette question : pas de hot take possible.'
    else if (!answers[q]) reason = 'Fais d’abord ton choix.'
    else if (!questionHotTakeAllowed(q, answers[q], odds))
      reason = `Choix trop attendu : un hot take doit être au moins ${SCORING.htOddsRatio} fois moins probable que le favori des bookmakers.`
    else if (hotQuestions.length >= SCORING.htMaxQuestions)
      reason = `Tu as déjà tes ${SCORING.htMaxQuestions} hot takes questions : retires-en un pour allumer celui-ci.`
  }
  return { on, enabled: on || reason === null, reason, noMarket }
}

/** The market's top picks, most likely first. */
export function topFavorites(market: Record<string, number>, n = 3): { id: string; p: number }[] {
  return Object.entries(market)
    .map(([id, p]) => ({ id, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
}

/** 0.316 -> "32 %" (French spacing); tiny values -> "< 1 %". */
export function formatPct(p: number): string {
  if (p < 0.005) return '< 1 %'
  return `${Math.round(p * 100)} %`
}
