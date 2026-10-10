// Pure parsers for ESPN's unofficial JSON APIs (standings, awards, scoreboards, stat leaders).
// No Next, no DB, no JSON imports: tested with `node --test` against the real responses captured
// in __fixtures__/. ESPN data is untrusted, so every field is read defensively.
import { SEASON } from '../config/season.ts'
import { TEAMS } from '../data/teams.ts'
import type { Conf, Team, TeamAbbr, TeamStanding } from './types.ts'

const TEAM_BY_ESPN_ID = new Map(TEAMS.map((t) => [t.espnId, t]))
const TEAM_BY_ESPN_ABBR = new Map(TEAMS.map((t) => [t.espnAbbr, t]))

/** ESPN team id (stable) or ESPN abbreviation ("NY", "GS"…) to our team. */
export function teamFromEspn(id?: unknown, abbr?: unknown): Team | null {
  return (
    (typeof id === 'string' || typeof id === 'number' ? TEAM_BY_ESPN_ID.get(String(id)) : undefined) ??
    (typeof abbr === 'string' ? TEAM_BY_ESPN_ABBR.get(abbr) : undefined) ??
    null
  )
}

/** Numeric id at the end of a core API `$ref`, e.g. ".../athletes/4278073?lang=en" -> "4278073". */
export function refId(ref: unknown, kind: 'athletes' | 'teams' | 'awards'): string | null {
  if (typeof ref !== 'string') return null
  return ref.match(new RegExp(`/${kind}/(\\d+)`))?.[1] ?? null
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

// ---------------------------------------------------------------- standings

interface EspnStandingsGroup {
  standings?: {
    season?: number
    seasonType?: number
    entries?: { team?: { id?: string; abbreviation?: string }; stats?: { name?: string; value?: number }[] }[]
  }
  children?: EspnStandingsGroup[]
}

/**
 * `apis/v2/.../standings` -> W/L for the 30 teams. Throws when the payload is not a complete,
 * sane regular-season table (so callers fall back to the last good copy instead of storing junk).
 * `season` (ESPN ending year) guards against ESPN silently serving another season.
 */
export function parseStandings(json: unknown, season?: number): TeamStanding[] {
  const entries: NonNullable<NonNullable<EspnStandingsGroup['standings']>['entries']> = []
  const walk = (g: EspnStandingsGroup | undefined, depth: number) => {
    if (!g || typeof g !== 'object' || depth > 4) return
    const st = g.standings
    if (st?.entries?.length) {
      if (season !== undefined && st.season !== undefined && st.season !== season)
        throw new Error(`ESPN standings: season ${st.season} instead of ${season}`)
      if (st.seasonType !== undefined && st.seasonType !== 2)
        throw new Error(`ESPN standings: season type ${st.seasonType} instead of 2`)
      entries.push(...st.entries)
    }
    for (const child of g.children ?? []) walk(child, depth + 1)
  }
  walk(json as EspnStandingsGroup, 0)

  const out = new Map<TeamAbbr, TeamStanding>()
  for (const e of entries) {
    const team = teamFromEspn(e.team?.id, e.team?.abbreviation)
    if (!team) throw new Error(`ESPN standings: unknown team ${e.team?.id}/${e.team?.abbreviation}`)
    const stat = (name: string) => e.stats?.find((s) => s.name === name)?.value
    const w = stat('wins')
    const l = stat('losses')
    if (!isCount(w) || !isCount(l) || w + l > SEASON.gamesPerTeam)
      throw new Error(`ESPN standings: bad record for ${team.abbr}`)
    out.set(team.abbr, { abbr: team.abbr, conference: team.conference, w, l })
  }
  if (out.size !== TEAMS.length) throw new Error(`ESPN standings: ${out.size} teams instead of ${TEAMS.length}`)
  return [...out.values()].sort(
    (a, b) => a.conference.localeCompare(b.conference) || b.w - a.w || a.l - b.l || a.abbr.localeCompare(b.abbr),
  )
}

// ---------------------------------------------------------------- awards

interface EspnAward {
  winners?: { athlete?: { $ref?: string }; team?: { $ref?: string } }[]
}

/** Core `seasons/{y}/awards/{id}` -> winning athlete ids (several when shared, empty if not given yet). */
export function parseAwardWinners(json: unknown): string[] {
  const ids = ((json as EspnAward)?.winners ?? []).map((w) => refId(w?.athlete?.$ref, 'athletes'))
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

/** Core `seasons/{y}/awards` index -> the award ids already published for that season. */
export function parseAwardIndex(json: unknown): number[] {
  const items = (json as { items?: { $ref?: string }[] })?.items ?? []
  return items.map((i) => Number(refId(i?.$ref, 'awards'))).filter((n) => Number.isInteger(n) && n > 0)
}

// ---------------------------------------------------------------- scoreboards

interface EspnCompetitor {
  id?: string
  winner?: boolean
  team?: { id?: string; abbreviation?: string }
}
interface EspnCompetition {
  type?: { abbreviation?: string }
  notes?: { headline?: string }[]
  status?: { type?: { completed?: boolean } }
  series?: { type?: string; completed?: boolean; competitors?: { id?: string; wins?: number }[] }
  competitors?: EspnCompetitor[]
}
interface EspnEvent {
  season?: { year?: number; type?: number }
  status?: { type?: { completed?: boolean } }
  competitions?: EspnCompetition[]
}
interface EspnScoreboard {
  events?: EspnEvent[]
  leagues?: { calendar?: unknown[] }[]
}

const eventsOf = (json: unknown): EspnEvent[] => {
  const events = (json as EspnScoreboard)?.events
  return Array.isArray(events) ? events : []
}
const notesOf = (c: EspnCompetition) => (c.notes ?? []).map((n) => n?.headline ?? '').join(' | ')
const isCompleted = (e: EspnEvent, c: EspnCompetition) => (c.status?.type?.completed ?? e.status?.type?.completed) === true
const competitorTeam = (x: EspnCompetitor | undefined) => (x ? teamFromEspn(x.team?.id ?? x.id, x.team?.abbreviation) : null)

/**
 * Scoreboard of the NBA Cup final's day -> winner tricode, or null while the final is not over
 * (or not on that day). The final is the competition typed "CC" / noted "NBA Cup Championship".
 */
export function parseCupFinal(json: unknown): TeamAbbr | null {
  for (const e of eventsOf(json)) {
    const c = e.competitions?.[0]
    if (!c) continue
    const isFinal = c.type?.abbreviation === 'CC' || /(NBA Cup|In-Season Tournament) Championship/i.test(notesOf(c))
    if (!isFinal || !isCompleted(e, c)) continue
    const winner = competitorTeam(c.competitors?.find((x) => x?.winner === true))
    if (winner) return winner.abbr
  }
  return null
}

/** Days listed in a scoreboard's season calendar ("2026-05-12T07:00Z" -> "2026-05-12"), sorted. */
export function parseCalendar(json: unknown): string[] {
  const cal = (json as EspnScoreboard)?.leagues?.[0]?.calendar ?? []
  const days = cal
    .map((d) => (typeof d === 'string' ? d.slice(0, 10) : typeof d === 'object' && d ? String((d as { date?: string }).date ?? '').slice(0, 10) : ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  return [...new Set(days)].sort()
}

export type PlayoffRound = 'early' | 'confFinals' | 'finals'

export interface PlayoffGame {
  round: PlayoffRound
  /** Conference of both teams; null for the NBA Finals. */
  conference: Conf | null
  teams: [TeamAbbr, TeamAbbr]
  /** The series is decided once this game is over. */
  seriesOver: boolean
  /** Series winner when `seriesOver`. */
  winner: TeamAbbr | null
}

/**
 * Postseason games of one scoreboard day. ESPN types conference semis "QTR", conference finals
 * "SEMI" ("East Finals - Game 4") and the NBA Finals "FINAL" ("NBA Finals - Game 5"); each game
 * carries the series state after it ("NY wins series 4-1", completed: true).
 * Regular-season events are ignored: the Cup final also carries a `series` object.
 */
export function parsePlayoffGames(json: unknown): PlayoffGame[] {
  const out: PlayoffGame[] = []
  for (const e of eventsOf(json)) {
    if (e.season?.type !== 3) continue
    const c = e.competitions?.[0]
    if (!c) continue
    const a = competitorTeam(c.competitors?.[0])
    const b = competitorTeam(c.competitors?.[1])
    if (!a || !b || a.abbr === b.abbr) continue
    const notes = notesOf(c)
    const type = c.type?.abbreviation
    const round: PlayoffRound =
      type === 'FINAL' || /\bNBA Finals\b/i.test(notes)
        ? 'finals'
        : type === 'SEMI' || /\b(East|West)(ern Conference)? Finals\b/i.test(notes)
          ? 'confFinals'
          : 'early'
    const seriesOver = c.series?.completed === true
    let winner: TeamAbbr | null = null
    if (seriesOver) {
      const best = [...(c.series?.competitors ?? [])].sort((x, y) => (y?.wins ?? 0) - (x?.wins ?? 0))[0]
      winner =
        teamFromEspn(best?.id)?.abbr ??
        // Fallback: the series ended with this game, so its winner won the series.
        (isCompleted(e, c) ? competitorTeam(c.competitors?.find((x) => x?.winner === true))?.abbr ?? null : null)
      if (winner !== a.abbr && winner !== b.abbr) winner = null
    }
    out.push({
      round,
      conference: a.conference === b.conference ? a.conference : null,
      teams: [a.abbr, b.abbr],
      seriesOver: seriesOver && winner !== null,
      winner,
    })
  }
  return out
}

/**
 * Conference champions (= our "finalists") and NBA champion, found by walking scoreboard days
 * from the most recent one backwards. The latest game of a round tells its state: if that series
 * is over we have the winner, otherwise it is still being played. An NBA Finals game settles
 * both finalists at once; an earlier-round game means that conference's finals have not started.
 */
export interface FinalsScan {
  finalistE: TeamAbbr | null
  finalistW: TeamAbbr | null
  champion: TeamAbbr | null
  settled: { E: boolean; W: boolean; finals: boolean }
}

export function emptyFinalsScan(): FinalsScan {
  return { finalistE: null, finalistW: null, champion: null, settled: { E: false, W: false, finals: false } }
}

/** Feeds one day of games (days must be fed newest first). Returns a new state. */
export function stepFinalsScan(prev: FinalsScan, games: PlayoffGame[]): FinalsScan {
  const s: FinalsScan = { ...prev, settled: { ...prev.settled } }
  for (const g of games) {
    if (g.round === 'finals') {
      if (s.settled.finals) continue
      const confs = g.teams.map((t) => TEAMS.find((x) => x.abbr === t)?.conference)
      const east = g.teams[confs.indexOf('E')]
      const west = g.teams[confs.indexOf('W')]
      if (!east || !west) continue
      s.settled.finals = true
      s.champion = g.seriesOver ? g.winner : null
      // The Finals teams are the conference champions, whatever the earlier days say.
      s.finalistE = east
      s.finalistW = west
      s.settled.E = s.settled.W = true
    } else if (g.conference && !s.settled[g.conference]) {
      s.settled[g.conference] = true
      const finalist = g.round === 'confFinals' && g.seriesOver ? g.winner : null
      if (g.conference === 'E') s.finalistE = finalist
      else s.finalistW = finalist
    }
  }
  return s
}

/** Nothing older can change the answer once both conferences are settled. */
export function finalsScanDone(s: FinalsScan): boolean {
  return s.settled.E && s.settled.W
}

// ---------------------------------------------------------------- scoring leader

export interface ScoringLine {
  id: string
  name: string
  gp: number
  points: number
}

interface EspnByAthlete {
  requestedSeason?: { year?: number; type?: { type?: number } }
  categories?: { name?: string; names?: string[] }[]
  athletes?: {
    athlete?: { id?: string; displayName?: string }
    categories?: { name?: string; values?: unknown[] }[]
  }[]
}

/**
 * `statistics/byathlete` -> games played and total points per player. Throws if the response
 * is for another season than `season` (ESPN ending year) when given.
 */
export function parseScoringLines(json: unknown, season?: number): ScoringLine[] {
  const j = json as EspnByAthlete
  const year = j?.requestedSeason?.year
  if (season !== undefined && year !== undefined && year !== season)
    throw new Error(`ESPN leaders: season ${year} instead of ${season}`)
  const names = (cat: string) => j?.categories?.find((c) => c?.name === cat)?.names ?? []
  const gpIdx = names('general').indexOf('gamesPlayed')
  const offensive = names('offensive')
  const ptsIdx = offensive.indexOf('points')
  const avgIdx = offensive.indexOf('avgPoints')
  if (gpIdx < 0 || (ptsIdx < 0 && avgIdx < 0)) throw new Error('ESPN leaders: unexpected categories')

  const out: ScoringLine[] = []
  for (const a of j.athletes ?? []) {
    const id = a?.athlete?.id
    const values = (cat: string) => a?.categories?.find((c) => c?.name === cat)?.values ?? []
    const gp = Number(values('general')[gpIdx])
    const off = values('offensive')
    const points = ptsIdx >= 0 ? Number(off[ptsIdx]) : Math.round(Number(off[avgIdx]) * gp)
    if (typeof id !== 'string' || !/^\d+$/.test(id) || !isCount(gp) || gp === 0 || !isCount(points)) continue
    out.push({ id, name: a?.athlete?.displayName ?? id, gp, points })
  }
  return out
}

/** NBA minimum for per-game titles: 70% of the games (58 of 82). */
export const SCORING_MIN_GAMES = Math.ceil(0.7 * SEASON.gamesPerTeam)

/**
 * Official points-per-game leader(s) under the NBA rule: at least `minGames` games, or enough
 * points that total / minGames would still lead (nba.com/stats/help/statminimums).
 * Several ids only for an exact tie.
 */
export function scoringLeaders(lines: ScoringLine[], minGames = SCORING_MIN_GAMES): string[] {
  const ppg = (l: ScoringLine) => l.points / l.gp
  const bestQualified = Math.max(0, ...lines.filter((l) => l.gp >= minGames).map(ppg))
  const eligible = lines.filter((l) => l.gp >= minGames || l.points / minGames > bestQualified)
  if (!eligible.length) return []
  const best = Math.max(...eligible.map(ppg))
  // Exact comparison on the fractions (points * gp') to avoid float noise on ties.
  const top = eligible.find((l) => ppg(l) === best)!
  return eligible.filter((l) => l.points * top.gp === top.points * l.gp).map((l) => l.id)
}

/** Convenience: the qualified scoring leader's athlete id (first one on an exact tie). */
export function parseScoringLeader(json: unknown, minGames = SCORING_MIN_GAMES): string | null {
  return scoringLeaders(parseScoringLines(json), minGames)[0] ?? null
}

// ---------------------------------------------------------------- dates

/** ESPN scoreboard days are US dates: "YYYY-MM-DD" of `d` in US Eastern time (approx. UTC-5). */
export function usDay(d: Date): string {
  return new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)
}

/** "2026-12-11" -> "20261211" (the scoreboard `dates` parameter). */
export const compactDay = (day: string) => day.replaceAll('-', '')

/** Every day from `from` to `to` (inclusive, "YYYY-MM-DD"), newest first. */
export function daysBackwards(to: string, from: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${to}T00:00:00Z`); t >= Date.parse(`${from}T00:00:00Z`); t -= 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
