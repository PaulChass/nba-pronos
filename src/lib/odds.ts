// Bookmaker odds for the questions, used by the question hot-take test:
// - ESPN core futures feed (DraftKings) for most questions;
// - Kambi (BetRivers / Unibet) public JSON for the ones ESPN lacks (scoring leader, Finals MVP),
//   with a hand-captured copy as a last resort (config/extra-odds.ts).
// The daily cron refreshes the snapshot in kv until the lock; after the lock the last pre-lock
// snapshot is frozen. A question with no odds at all gets no hot take.
import fallbackFutures from '@/data/futures-fallback.json'
import { KAMBI_MARKETS, MANUAL_ODDS } from '@/config/extra-odds'
import { QUESTION_BY_ID, QUESTIONS } from '@/config/questions'
import { isLocked } from '@/config/season'
import { kvGet, kvSet } from './db'
import { PLAYERS, TEAM_BY_ESPN_ID } from './data'
import { americanToProbability, devig, kambiMarket, normalizeName, playerNameIndex, type KambiBetOffers } from './odds-parse'
import type { QuestionId, QuestionOdds } from './types'

export const FUTURES_URL = (season: number) =>
  `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${season}/futures?limit=100`
const KAMBI_URL = (eventId: number) =>
  `https://eu-offering-api.kambicdn.com/offering/v2018/rsiuspa/betoffer/event/${eventId}.json?lang=en_US&market=US`
export const ODDS_KV_KEY = 'futures-snapshot'

interface EspnFutures {
  items: {
    name: string
    futures?: { provider?: { name?: string }; books: { team?: { $ref: string }; athlete?: { $ref: string }; value: string }[] }[]
  }[]
}

/** American odds ("+270", "-360") to implied probability. */
export function impliedProbability(american: string): number | null {
  return americanToProbability(american)
}

const cleanName = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim()
const PLAYER_INDEX = playerNameIndex(PLAYERS)

/** Only for questions ESPN's feed does not cover at all: never shadows an ESPN market. */
const isExtraQuestion = (q: string): q is QuestionId => Object.hasOwn(QUESTION_BY_ID, q) && !QUESTION_BY_ID[q as QuestionId].futuresMarket

/** Hand-captured fallback markets (config/extra-odds.ts), de-vigged and keyed by ESPN player id. */
export function manualMarkets(): QuestionOdds {
  const out: QuestionOdds = {}
  for (const [q, market] of Object.entries(MANUAL_ODDS)) {
    if (!market || !isExtraQuestion(q)) continue
    const raw: Record<string, number> = {}
    for (const e of market.entries) {
      const id = PLAYER_INDEX.get(normalizeName(e.name))
      const p = americanToProbability(e.american)
      if (id && p !== null) raw[id] = p
    }
    const m = devig(raw)
    if (m) out[q] = m
  }
  return out
}

/** Kambi markets for the questions ESPN lacks. Never throws: failures are listed in `errors`. */
export async function fetchKambiMarkets(userAgent: string): Promise<{ odds: QuestionOdds; errors: string[] }> {
  const odds: QuestionOdds = {}
  const errors: string[] = []
  await Promise.all(
    Object.entries(KAMBI_MARKETS).map(async ([q, cfg]) => {
      if (!cfg || !isExtraQuestion(q)) return
      try {
        const res = await fetch(KAMBI_URL(cfg.eventId), {
          headers: { 'user-agent': userAgent, accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { market } = kambiMarket((await res.json()) as KambiBetOffers, cfg.offerLabel, PLAYER_INDEX)
        if (!market || Object.keys(market).length < 5) throw new Error('offer missing or closed')
        odds[q] = market
      } catch (err) {
        errors.push(`${q}: Kambi ${err instanceof Error ? err.message : String(err)}`)
      }
    }),
  )
  return { odds, errors }
}

/** ESPN futures JSON -> de-vigged probabilities per question (answer ids: tricode / ESPN id). */
export function parseFutures(json: EspnFutures): QuestionOdds {
  const out: QuestionOdds = {}
  for (const q of QUESTIONS) {
    if (!q.futuresMarket) continue
    const item = json.items.find((i) => cleanName(i.name) === q.futuresMarket)
    const books = item?.futures?.[0]?.books
    if (!books?.length) continue
    const raw: Record<string, number> = {}
    for (const b of books) {
      const p = impliedProbability(b.value)
      const ref = b.team?.$ref ?? b.athlete?.$ref
      const espnId = ref?.match(/\/(teams|athletes)\/(\d+)/)?.[2]
      if (p === null || !espnId) continue
      const id = b.team ? TEAM_BY_ESPN_ID[espnId]?.abbr : espnId
      if (id) raw[id] = p
    }
    const m = devig(raw)
    if (m) out[q.id] = m
  }
  return out
}

const FALLBACK_AS_OF = '2026-10-13T12:00:00Z'
const fallbackOdds = (): QuestionOdds => parseFutures(fallbackFutures as EspnFutures)

/**
 * Odds used for hot takes right now (before lock: latest snapshot; after: frozen). The bundled
 * copy is used only when no snapshot was ever stored, never to paper over a failed DB read: after
 * the lock that would silently change who qualified for a hot take.
 */
export async function getQuestionOdds(): Promise<{ odds: QuestionOdds; asOf: string; source: 'snapshot' | 'fallback' }> {
  // Before the lock, a market the snapshot does not hold yet falls back to the hand-captured copy;
  // after it, only the frozen snapshot counts.
  const live = (odds: QuestionOdds) => (isLocked() ? odds : { ...manualMarkets(), ...odds })
  if (!process.env.DATABASE_URL) return { odds: live(fallbackOdds()), asOf: FALLBACK_AS_OF, source: 'fallback' }
  const snap = await kvGet<QuestionOdds>(ODDS_KV_KEY)
  if (snap && Object.keys(snap.value).length) return { odds: live(snap.value), asOf: snap.updatedAt, source: 'snapshot' }
  return { odds: live(fallbackOdds()), asOf: FALLBACK_AS_OF, source: 'fallback' }
}

/**
 * Called by the daily cron before the lock. Merges per market: a market missing from today's feeds
 * keeps its last known odds (reported in `carried`), so the snapshot frozen at lock is never partial.
 */
export async function refreshOddsSnapshot(
  season: number,
  userAgent: string,
): Promise<{ markets: number; carried: string[]; extra: string[]; errors: string[] }> {
  const [res, kambi] = await Promise.all([
    fetch(FUTURES_URL(season), {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }),
    fetchKambiMarkets(userAgent),
  ])
  if (!res.ok) throw new Error(`ESPN futures ${res.status}`)
  const fresh = parseFutures((await res.json()) as EspnFutures)
  if (Object.keys(fresh).length === 0) throw new Error('ESPN futures: no market parsed')
  const prev = (await kvGet<QuestionOdds>(ODDS_KV_KEY))?.value ?? {}
  const base = Object.keys(prev).length ? prev : fallbackOdds()
  // Precedence: today's feeds > last snapshot > hand-captured copy.
  const merged: QuestionOdds = { ...manualMarkets(), ...base, ...fresh, ...kambi.odds }
  const carried = QUESTIONS.filter((q) => q.futuresMarket && !fresh[q.id] && merged[q.id]).map((q) => q.id)
  // A run that started just before the lock must not write after it: the snapshot is frozen.
  if (isLocked()) throw new Error('locked: the odds snapshot is frozen')
  await kvSet(ODDS_KV_KEY, merged)
  return { markets: Object.keys(fresh).length, carried, extra: Object.keys(kambi.odds), errors: kambi.errors }
}
