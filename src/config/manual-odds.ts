import type { QuestionId } from '../lib/types.ts'

/**
 * Bookmaker odds captured by hand for the questions ESPN's futures feed does not cover at all
 * (questions without `futuresMarket` in questions.ts). Without odds a question gets no hot take,
 * so these markets are what makes a hot take possible on them. Merged into the odds snapshot by
 * the daily cron and frozen with it at the lock: update before the lock only.
 */
export interface ManualMarket {
  source: string
  sourceUrl: string
  asOf: string // ISO date of the odds
  /** ESPN athlete id (same ids as players.json), display name, American odds. */
  entries: { id: string; name: string; american: number }[]
}

export const MANUAL_ODDS: Partial<Record<QuestionId, ManualMarket>> = {}
