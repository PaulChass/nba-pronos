import type { TeamAbbr } from '../lib/types.ts'
import { SEASON } from './season.ts'

/**
 * Preseason regular-season win totals (over/under), BetMGM board published 2026-10-09:
 * https://sports.betmgm.com/en/blog/nba/nba-odds-predictions-season-win-totals-bm23/
 * Used as "the bookmakers' view" for hot takes and as the prior of the live projection.
 * ESPN's futures feed has no win totals, so these are frozen here.
 */
export const BOOKMAKER_SOURCE = 'BetMGM, 9 oct. 2026'

export const BOOKMAKER_LINES: Record<TeamAbbr, number> = {
  ATL: 43.5, BOS: 51.5, BKN: 24.5, CHA: 39.5, CHI: 29.5,
  CLE: 47.5, DET: 49.5, IND: 43.5, MIA: 46.5, MIL: 25.5,
  NYK: 52.5, ORL: 43.5, PHI: 50.5, TOR: 46.5, WAS: 34.5,
  DAL: 34.5, DEN: 49.5, GSW: 40.5, HOU: 48.5, LAC: 28.5,
  LAL: 46.5, MEM: 29.5, MIN: 48.5, NOP: 27.5, OKC: 62.5,
  PHX: 40.5, POR: 42.5, SAC: 21.5, SAS: 59.5, UTA: 37.5,
}

/**
 * Lines rescaled so they sum to the 1230 wins that actually exist (the raw board sums to 1246),
 * rounded to one decimal. This is the reference line L' used everywhere in scoring.
 */
export const NORMALIZED_LINES: Record<TeamAbbr, number> = (() => {
  const sum = Object.values(BOOKMAKER_LINES).reduce((a, b) => a + b, 0)
  const factor = SEASON.totalWins / sum
  return Object.fromEntries(
    Object.entries(BOOKMAKER_LINES).map(([abbr, line]) => [abbr, Math.round(line * factor * 10) / 10]),
  )
})()
