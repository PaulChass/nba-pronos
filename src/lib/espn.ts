// ESPN data access — CONTRACT STUB. Implemented by the ESPN workstream.
// Server-only. ESPN's JSON APIs are unofficial: every fetch is cached, and the last good
// standings are kept in kv so the leaderboard survives an ESPN outage.
import type { Results, TeamStanding } from './types'

/** Browser-like UA: ESPN rejects some bot user agents (e.g. "Claude-User"). */
export const ESPN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'

export interface StandingsResult {
  teams: TeamStanding[]
  fetchedAt: string // ISO
  source: 'live' | 'cache'
}

/** Regular-season standings for the configured season (W/L per team, by conference). */
export async function getStandings(): Promise<StandingsResult> {
  throw new Error('not implemented')
}

/**
 * Question results detected automatically from ESPN: awards (7 of 8 — not Coach of the Year),
 * NBA Cup winner, conference champions (finalists), NBA champion, scoring leader.
 * Unknown yet = absent or { status: 'pending' }.
 */
export async function getAutoResults(): Promise<Results> {
  throw new Error('not implemented')
}
