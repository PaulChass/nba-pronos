import type { QuestionId } from '../lib/types.ts'

// Odds for the questions ESPN's futures feed does not cover (no `futuresMarket` in questions.ts).
// Without odds a question gets no hot take, so these markets are what makes one possible there.
// Both are merged into the odds snapshot by the daily cron and frozen with it at the lock.

/**
 * Kambi (the BetRivers / Unibet sportsbook platform) public JSON, fetched by the daily cron:
 * https://eu-offering-api.kambicdn.com/offering/v2018/rsiuspa/betoffer/event/{eventId}.json
 * Found 2026-10-13; the bet offer is picked by its label.
 */
export const KAMBI_MARKETS: Partial<Record<QuestionId, { eventId: number; offerLabel: string }>> = {
  scoring: { eventId: 1028657309, offerLabel: 'League scoring leader - points per game' },
  fmvp: { eventId: 1028748190, offerLabel: 'NBA Finals MVP' },
}

export interface ManualMarket {
  source: string
  asOf: string // ISO date of the odds
  /** Bookmaker names (matched to players.json by normalized name) and American odds. */
  entries: { name: string; american: number }[]
}

/**
 * Fallback copy of the same Kambi boards (top 30), used only when the cron could not fetch them
 * and no snapshot holds them yet. Bovada's scoring board (2026-10-10) agrees within a few points.
 */
export const MANUAL_ODDS: Partial<Record<QuestionId, ManualMarket>> = {
  scoring: {
    source: 'Kambi (BetRivers / Unibet), « League scoring leader - points per game »',
    asOf: '2026-10-05',
    entries: [
      { name: 'Luka Dončić', american: -110 },
      { name: 'Shai Gilgeous-Alexander', american: 250 },
      { name: 'Giannis Antetokounmpo', american: 1000 },
      { name: 'Anthony Edwards', american: 1400 },
      { name: 'Jayson Tatum', american: 1800 },
      { name: 'Nikola Jokić', american: 3000 },
      { name: 'Donovan Mitchell', american: 4000 },
      { name: 'Victor Wembanyama', american: 4000 },
      { name: 'Jalen Brunson', american: 6000 },
      { name: 'Devin Booker', american: 8000 },
      { name: 'Tyrese Maxey', american: 8000 },
      { name: 'Kevin Durant', american: 10000 },
      { name: 'Austin Reaves', american: 15000 },
      { name: 'Cade Cunningham', american: 15000 },
      { name: 'Jamal Murray', american: 15000 },
      { name: 'Jaylen Brown', american: 15000 },
      { name: 'Joel Embiid', american: 15000 },
      { name: 'Kawhi Leonard', american: 15000 },
      { name: 'Stephen Curry', american: 15000 },
      { name: 'Trae Young', american: 15000 },
      { name: 'Deni Avdija', american: 20000 },
      { name: 'Cooper Flagg', american: 25000 },
      { name: 'Ja Morant', american: 25000 },
      { name: 'Jalen Johnson', american: 25000 },
      { name: 'James Harden', american: 25000 },
      { name: 'Kyrie Irving', american: 25000 },
      { name: 'Lauri Markkanen', american: 25000 },
      { name: 'Michael Porter Jr.', american: 25000 },
      { name: 'Paolo Banchero', american: 25000 },
      { name: 'Tyler Herro', american: 25000 },
    ],
  },
  fmvp: {
    source: 'Kambi (BetRivers / Unibet), « NBA Finals MVP »',
    asOf: '2026-08-14',
    entries: [
      { name: 'Shai Gilgeous-Alexander', american: 275 },
      { name: 'Victor Wembanyama', american: 275 },
      { name: 'Jalen Brunson', american: 1200 },
      { name: 'Jayson Tatum', american: 2000 },
      { name: 'Nikola Jokić', american: 2500 },
      { name: 'Anthony Edwards', american: 3000 },
      { name: 'Cade Cunningham', american: 3000 },
      { name: 'Kawhi Leonard', american: 3000 },
      { name: 'Tyrese Maxey', american: 3000 },
      { name: 'Donovan Mitchell', american: 4000 },
      { name: 'Giannis Antetokounmpo', american: 4000 },
      { name: 'Jaylen Brown', american: 4000 },
      { name: 'Joel Embiid', american: 4000 },
      { name: 'Karl-Anthony Towns', american: 4000 },
      { name: 'Luka Dončić', american: 4000 },
      { name: 'Jalen Williams', american: 6000 },
      { name: 'Kevin Durant', american: 6000 },
      { name: 'LeBron James', american: 6000 },
      { name: 'Scottie Barnes', american: 8000 },
      { name: 'Stephen Curry', american: 8000 },
      { name: 'Tyrese Haliburton', american: 8000 },
      { name: 'Dylan Harper', american: 10000 },
      { name: 'Franz Wagner', american: 10000 },
      { name: 'Jalen Johnson', american: 10000 },
      { name: 'OG Anunoby', american: 10000 },
      { name: 'Paolo Banchero', american: 10000 },
      { name: 'Stephon Castle', american: 10000 },
      { name: 'Bam Adebayo', american: 15000 },
      { name: 'Brandon Miller', american: 15000 },
      { name: 'CJ McCollum', american: 15000 },
    ],
  },
}
