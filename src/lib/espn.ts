// ESPN data access. Server-only. ESPN's JSON APIs are unofficial, so kv (Postgres) is the only
// cache in front of them: every ESPN call is a live `no-store` fetch (Next's data cache is never
// used: `force-dynamic` does not disable a fetch that sets `next.revalidate`, and a stale cached
// response could overwrite a newer kv copy), and kv keeps ESPN to a few calls per hour whatever
// the traffic.
// - Standings: kv copy younger than 30 min is served as is; otherwise ESPN, then kv (never
//   replaced by an older copy). If ESPN fails, the last good copy is served (source 'cache').
// - Question results: each ESPN source is asked at most every few hours, only once its date
//   gate is passed; what ESPN has settled is frozen in kv (a final result never changes). Writes
//   are atomic merges of what the call learnt, so concurrent requests never drop each other's work.
// - A failed kv read throws (no silent "everything pending"); only a missing DATABASE_URL means
//   "no database".
// Parsing lives in espn-parse.ts (pure, unit-tested against captured responses).
import { cache } from 'react'
import { QUESTION_BY_ID, QUESTIONS } from '@/config/questions'
import { isRegularSeasonOver, lockAt, SEASON } from '@/config/season'
import { TEAMS } from '@/data/teams'
import { kvGet, kvSet, sql } from './db'
import {
  compactDay,
  daysBackwards,
  emptyFinalsScan,
  finalsScanDone,
  parseAwardIndex,
  parseAwardWinners,
  parseCalendar,
  parseCupFinal,
  parsePlayoffGames,
  parseScoringLines,
  parseStandings,
  scoringLeaders,
  stepFinalsScan,
  usDay,
} from './espn-parse'
import type { QuestionId, QuestionResult, Results, TeamStanding } from './types'

/** Browser-like UA: ESPN rejects some bot user agents (e.g. "Claude-User"). */
export const ESPN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

export interface StandingsResult {
  teams: TeamStanding[]
  fetchedAt: string // ISO
  source: 'live' | 'cache'
}

const Y = SEASON.espnSeason
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const CORE = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${Y}`
export const STANDINGS_URL = `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${Y}&seasontype=2`
// Unqualified list sorted by total points: it holds both the qualified leader and anyone who
// could lead through the NBA's "points / 58 games" exception (we apply the rule ourselves).
const LEADERS_URL =
  'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete' +
  `?region=us&lang=en&contentorigin=espn&isqualified=false&limit=50&sort=offensive.points:desc&season=${Y}&seasontype=2`
const scoreboardUrl = (day: string) => `${SITE}/scoreboard?dates=${compactDay(day)}`
const awardsUrl = (id?: number) => `${CORE}/awards${id ? `/${id}` : ''}?lang=en&region=us`

const STANDINGS_KV = 'standings'
const RESULTS_KV = 'auto-results'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const STANDINGS_FRESH = 30 * MINUTE

/** Live GET + JSON with a browser-like UA (no Next data cache: kv is the cache). */
async function espnJson(url: string): Promise<{ json: unknown; date: string | null }> {
  const res = await fetch(url, {
    headers: { 'user-agent': ESPN_UA, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ESPN ${res.status} on ${url.split('?')[0]}`)
  return { json: await res.json(), date: res.headers.get('date') }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ---------------------------------------------------------------- standings

interface StoredStandings {
  teams: TeamStanding[]
  fetchedAt: string // when ESPN produced these numbers
}

async function readStoredStandings(): Promise<StoredStandings | null> {
  const stored = await kvGet<StoredStandings>(STANDINGS_KV).catch(() => null)
  const v = stored?.value
  if (!v || !Array.isArray(v.teams) || v.teams.length !== TEAMS.length || Number.isNaN(Date.parse(v.fetchedAt))) return null
  return v
}

async function fetchStandings(): Promise<StoredStandings> {
  const { json, date } = await espnJson(STANDINGS_URL)
  const teams = parseStandings(json, Y)
  // ESPN's Date header (an edge-cached response keeps it): the real age of the data.
  const dated = date ? Date.parse(date) : NaN
  return { teams, fetchedAt: new Date(Number.isNaN(dated) ? Date.now() : Math.min(dated, Date.now())).toISOString() }
}

/** Regular-season standings for the configured season (W/L per team, by conference). */
export async function getStandings(): Promise<StandingsResult> {
  const stored = await readStoredStandings()
  if (stored && Date.now() - Date.parse(stored.fetchedAt) < STANDINGS_FRESH) return { ...stored, source: 'live' }
  try {
    const fresh = await fetchStandings()
    // Never replace kv with an older copy (e.g. the cron wrote newer numbers meanwhile).
    if (stored && Date.parse(fresh.fetchedAt) <= Date.parse(stored.fetchedAt)) return { ...stored, source: 'live' }
    await kvSet(STANDINGS_KV, fresh).catch((err) => console.warn('[espn] standings kv write failed:', errorText(err)))
    return { ...fresh, source: 'live' }
  } catch (err) {
    console.warn('[espn] standings fetch failed, serving the last good copy:', errorText(err))
    if (stored) return { ...stored, source: 'cache' }
    // Before the first tip-off every record is 0-0 anyway.
    if (Date.now() < lockAt().getTime())
      return {
        teams: TEAMS.map((t) => ({ abbr: t.abbr, conference: t.conference, w: 0, l: 0 })),
        fetchedAt: new Date().toISOString(),
        source: 'cache',
      }
    throw err
  }
}

/** Cron: live ESPN call (no cache) and kv write, whatever the age of the stored copy. */
export async function refreshStandings(): Promise<{ teams: number; gamesPlayed: number; fetchedAt: string }> {
  const fresh = await fetchStandings()
  await kvSet(STANDINGS_KV, fresh)
  return { teams: fresh.teams.length, gamesPlayed: fresh.teams.reduce((s, t) => s + t.w, 0), fetchedAt: fresh.fetchedAt }
}

// ---------------------------------------------------------------- question results

type SourceName = 'cup' | 'scoring' | 'awards' | 'finals'

/** How long a "not yet" answer from a source is trusted before ESPN is asked again (pages). */
const RECHECK: Record<SourceName, number> = { cup: 2 * HOUR, scoring: 6 * HOUR, awards: 3 * HOUR, finals: 2 * HOUR }

const time = (iso: string) => new Date(iso).getTime()
/** Date gates: ESPN is not asked before an answer can exist. */
const OPENS = {
  cup: time(`${SEASON.cupFinal}T00:00:00Z`),
  awards: time(`${Y}-04-15T00:00:00Z`), // DPOY, Clutch, 6MOY, MIP, ROY from ~Apr 20; MVP mid-May
  finals: time(`${Y}-05-15T00:00:00Z`), // conference finals start around May 18
}
const FINALS_QS: QuestionId[] = ['finalistE', 'finalistW', 'champion']

function sourceOf(q: QuestionId): SourceName | null {
  if (q === 'coy') return null // ESPN has no Coach of the Year award: the admin enters it
  if (q === 'cup' || q === 'scoring') return q
  if (FINALS_QS.includes(q)) return 'finals'
  return QUESTION_BY_ID[q].espnAwardId !== undefined ? 'awards' : null
}

function isOpen(q: QuestionId, now: Date): boolean {
  const t = now.getTime()
  if (q === 'cup') return t >= OPENS.cup
  if (q === 'scoring') return isRegularSeasonOver(now)
  if (q === 'fmvp' || FINALS_QS.includes(q)) return t >= OPENS.finals
  return t >= OPENS.awards
}

async function loadCup(): Promise<Results> {
  const winner = parseCupFinal((await espnJson(scoreboardUrl(SEASON.cupFinal))).json)
  return { cup: finalOf(winner ? [winner] : []) }
}

async function loadScoring(): Promise<Results> {
  return { scoring: finalOf(scoringLeaders(parseScoringLines((await espnJson(LEADERS_URL)).json, Y))) }
}

/** The requested award questions, from the awards ESPN has published for the season. */
async function loadAwards(qs: QuestionId[]): Promise<Results> {
  const published = new Set(parseAwardIndex((await espnJson(awardsUrl())).json))
  const out: Results = {}
  await Promise.all(
    qs.map(async (q) => {
      const id = QUESTION_BY_ID[q].espnAwardId
      out[q] = id && published.has(id) ? finalOf(parseAwardWinners((await espnJson(awardsUrl(id))).json)) : PENDING
    }),
  )
  return out
}

/**
 * Conference champions and NBA champion: walks the season's game days from today backwards
 * (see stepFinalsScan) and stops as soon as both conferences are settled — usually 1 to 8 days.
 */
async function loadFinals(now: Date): Promise<Results> {
  const floor = `${Y}-04-15`
  const today = usDay(now)
  const last = today < `${Y}-06-30` ? today : `${Y}-06-30`
  const anchor = (await espnJson(scoreboardUrl(last))).json
  // The season calendar lists game days (skips off days); fall back to every day if it lacks the playoffs.
  const calendar = parseCalendar(anchor).filter((d) => d >= floor && d <= last)
  const days = (calendar.length ? calendar.reverse() : daysBackwards(last, floor)).slice(0, 60)
  let state = emptyFinalsScan()
  for (let i = 0; i < days.length && !finalsScanDone(state); ) {
    // The latest day alone often settles everything (after the Finals); then 4 days at a time.
    const batch = days.slice(i, i + (i === 0 ? 1 : 4))
    i += batch.length
    const jsons = await Promise.all(batch.map(async (d) => (d === last ? anchor : (await espnJson(scoreboardUrl(d))).json)))
    for (const json of jsons) {
      state = stepFinalsScan(state, parsePlayoffGames(json))
      if (finalsScanDone(state)) break
    }
  }
  const one = (t: string | null) => finalOf(t ? [t] : [])
  return { finalistE: one(state.finalistE), finalistW: one(state.finalistW), champion: one(state.champion) }
}

const PENDING: QuestionResult = { status: 'pending' }
function finalOf(winners: string[]): QuestionResult {
  return winners.length ? { status: 'final', winners, source: 'auto' } : PENDING
}

/** kv 'auto-results': results ESPN has settled (frozen) and when each source was last asked. */
interface AutoState {
  final: Results
  checkedAt: Partial<Record<SourceName, string>>
}

const hasDatabase = () => !!process.env.DATABASE_URL

/**
 * Null only when there is no database (unknown state). A failed read throws: answering "nothing
 * settled" instead would show every ESPN-settled question as pending and drop its points.
 */
async function readAutoState(): Promise<AutoState | null> {
  if (!hasDatabase()) return null
  const stored = await kvGet<AutoState>(RESULTS_KV)
  const state: AutoState = { final: {}, checkedAt: { ...(stored?.value?.checkedAt ?? {}) } }
  for (const q of QUESTIONS) {
    const r = stored?.value?.final?.[q.id]
    if (r?.status === 'final' && Array.isArray(r.winners) && r.winners.length && r.winners.every((w) => typeof w === 'string'))
      state.final[q.id] = { status: 'final', winners: r.winners, source: 'auto' }
  }
  return state
}

export interface AutoResultsReport {
  results: Results
  /** Sources asked to ESPN during this call. */
  checked: SourceName[]
  /** Questions final after this call (frozen ones included). */
  final: QuestionId[]
  /** Per source, when ESPN failed (those questions stay pending). */
  errors: Partial<Record<SourceName, string>>
}

/**
 * Merges what one call learnt into kv 'auto-results', atomically (one statement), instead of
 * writing back a whole state read before the ESPN calls:
 * - a result frozen meanwhile by a concurrent call is kept (an already frozen result wins);
 * - a result the admin forgot meanwhile is not written back (the delta only holds results this
 *   call fetched, and a forgotten question was frozen, so not fetched, when the call started).
 */
async function mergeAutoState(delta: AutoState): Promise<void> {
  await sql()`
    insert into kv (key, value, updated_at) values (${RESULTS_KV}, ${JSON.stringify(delta)}::jsonb, now())
    on conflict (key) do update set value = jsonb_build_object(
      'final', (excluded.value->'final')
        || (case when jsonb_typeof(kv.value->'final') = 'object' then kv.value->'final' else '{}'::jsonb end),
      'checkedAt', (case when jsonb_typeof(kv.value->'checkedAt') = 'object' then kv.value->'checkedAt' else '{}'::jsonb end)
        || (excluded.value->'checkedAt')
    ), updated_at = now()`
}

/**
 * Core of getAutoResults / refreshAutoResults; `now` is injectable for scripts and tests.
 * ESPN failures are reported per source in `errors`; a failed kv read throws.
 */
export async function computeAutoResults(live: boolean, now = new Date()): Promise<AutoResultsReport> {
  const loaded = await readAutoState()
  // Without kv there is nothing to throttle ESPN calls with: pages then skip ESPN (the cron still asks).
  const state = loaded ?? { final: {}, checkedAt: {} }
  const need = QUESTIONS.map((q) => q.id).filter((q) => !state.final[q] && sourceOf(q) && isOpen(q, now))
  const due = (s: SourceName) =>
    need.some((q) => sourceOf(q) === s) &&
    (live || (loaded !== null && now.getTime() - (Date.parse(state.checkedAt[s] ?? '') || 0) >= RECHECK[s]))

  const loaders: Record<SourceName, () => Promise<Results>> = {
    cup: loadCup,
    scoring: loadScoring,
    awards: () => loadAwards(need.filter((q) => sourceOf(q) === 'awards')),
    finals: () => loadFinals(now),
  }
  const checked = (Object.keys(loaders) as SourceName[]).filter(due)
  const fetched: Results = {}
  const errors: AutoResultsReport['errors'] = {}
  await Promise.all(
    checked.map(async (s) => {
      try {
        Object.assign(fetched, await loaders[s]())
      } catch (err) {
        errors[s] = errorText(err)
        console.warn(`[espn] ${s} results unavailable:`, errors[s])
      }
    }),
  )

  // Freeze what ESPN has just settled, so it survives later ESPN changes or outages. Only this
  // call's news is written (see mergeAutoState).
  const delta: AutoState = { final: {}, checkedAt: {} }
  for (const q of need) if (fetched[q]?.status === 'final') state.final[q] = delta.final[q] = fetched[q]
  for (const s of checked) state.checkedAt[s] = delta.checkedAt[s] = now.toISOString()
  if (checked.length)
    await mergeAutoState(delta).catch((err) => console.warn('[espn] results kv write failed:', errorText(err)))

  const results: Results = {}
  for (const q of QUESTIONS) results[q.id] = state.final[q.id] ?? PENDING
  const final = QUESTIONS.map((q) => q.id).filter((q) => results[q]?.status === 'final')
  return { results, checked, final, errors }
}

/**
 * Question results detected automatically from ESPN: awards (7 of 8 — not Coach of the Year),
 * NBA Cup winner, conference champions (finalists), NBA champion, scoring leader.
 * Every question is present; unknown yet = { status: 'pending' }. An ESPN outage leaves the
 * questions pending; a failed kv read throws (pages show their "momentanément indisponible"
 * notice rather than silently dropping settled results). Memoized per render: the admin page
 * reads it directly and through getResults.
 */
export const getAutoResults = cache(async (): Promise<Results> => (await computeAutoResults(false)).results)

/**
 * Cron / admin refresh: asks every open source live, ignoring the recheck delays, and reports
 * per-source ESPN errors. Throws on a failed kv read (never overwrites kv with an empty state).
 */
export async function refreshAutoResults(): Promise<AutoResultsReport> {
  return computeAutoResults(true)
}

/**
 * Drops a frozen auto result so ESPN is asked again on the next request. Used when the admin
 * removes an override: "back to auto" then means ESPN's current answer, not an old frozen one.
 * Atomic (one statement): a result another request freezes meanwhile is kept.
 */
export async function forgetAutoResult(q: QuestionId): Promise<void> {
  if (!hasDatabase()) return
  const source = sourceOf(q)
  await sql()`
    update kv set value = value #- array['final', ${q}::text] #- array['checkedAt', ${source ?? ''}::text], updated_at = now()
    where key = ${RESULTS_KV}`
}
