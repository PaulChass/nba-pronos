// Everything specific to one NBA season lives in src/config/. To reuse the app next year:
// update this file, bookmaker-lines.ts, re-run `npm run data`, and reset the database.

export const SEASON = {
  label: '2026-27',
  /** ESPN labels a season by its ending year. */
  espnSeason: 2027,
  /**
   * Lock = first tip-off of the regular season: Celtics @ Pistons, Tue 20 Oct 2026, 3:00 pm ET
   * (21:00 Paris). Verified on ESPN's scoreboard and NBC/Fox on 2026-10-10.
   */
  lockAt: '2026-10-20T19:00:00Z',
  /** Last regular-season day: grid scores become final after it. */
  regularSeasonEnd: '2027-04-11',
  cupFinal: '2026-12-11',
  gamesPerTeam: 82,
  /** 30 teams x 82 games / 2: the league-wide number of wins. */
  totalWins: 1230,
} as const

/**
 * The effective lock instant. `LOCK_AT_OVERRIDE` (ISO date) exists only to test the post-lock
 * pages locally or on a preview deployment; never set it in production.
 * Server-only: client components receive the lock time as a prop.
 */
export function lockAt(): Date {
  const override = typeof process !== 'undefined' ? process.env.LOCK_AT_OVERRIDE : undefined
  return new Date(override || SEASON.lockAt)
}

export function isLocked(now: Date = new Date()): boolean {
  return now.getTime() >= lockAt().getTime()
}

/** True once the regular season is over (grid scores are final, not projected). */
export function isRegularSeasonOver(now: Date = new Date()): boolean {
  // The last games end around 04:00 UTC the next morning; give ESPN a few hours on top.
  return now.getTime() >= new Date(`${SEASON.regularSeasonEnd}T12:00:00Z`).getTime() + 86_400_000
}
