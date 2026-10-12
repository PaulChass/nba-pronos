// Bookmaker odds for the questions (ESPN core futures feed, DraftKings), used by the question
// hot-take test. The daily cron refreshes the snapshot in kv until the lock; after the lock the
// last pre-lock snapshot is frozen. If no snapshot exists, the file captured on 2026-10-10 is used.
import fallbackFutures from '@/data/futures-fallback.json'
import { MANUAL_ODDS } from '@/config/manual-odds'
import { QUESTION_BY_ID, QUESTIONS } from '@/config/questions'
import { isLocked } from '@/config/season'
import { kvGet, kvSet } from './db'
import { TEAM_BY_ESPN_ID } from './data'
import type { QuestionOdds } from './types'

export const FUTURES_URL = (season: number) =>
  `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${season}/futures?limit=100`
export const ODDS_KV_KEY = 'futures-snapshot'

interface EspnFutures {
  items: {
    name: string
    futures?: { provider?: { name?: string }; books: { team?: { $ref: string }; athlete?: { $ref: string }; value: string }[] }[]
  }[]
}

/** American odds ("+270", "-360") to implied probability. */
export function impliedProbability(american: string): number | null {
  const n = Number(american)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100)
}

const cleanName = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim()

/**
 * Hand-captured markets (config/manual-odds.ts), de-vigged, for the questions ESPN's feed does not
 * cover at all (no `futuresMarket`): they never shadow an ESPN market.
 */
export function manualMarkets(): QuestionOdds {
  const out: QuestionOdds = {}
  for (const [q, market] of Object.entries(MANUAL_ODDS) as [keyof typeof MANUAL_ODDS, NonNullable<(typeof MANUAL_ODDS)[keyof typeof MANUAL_ODDS]>][]) {
    if (!Object.hasOwn(QUESTION_BY_ID, q) || QUESTION_BY_ID[q].futuresMarket) continue
    const raw: Record<string, number> = {}
    for (const e of market.entries) {
      const p = impliedProbability(String(e.american))
      if (p !== null) raw[e.id] = p
    }
    const total = Object.values(raw).reduce((a, b) => a + b, 0)
    if (total > 0) out[q] = Object.fromEntries(Object.entries(raw).map(([id, p]) => [id, p / total]))
  }
  return out
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
    const total = Object.values(raw).reduce((a, b) => a + b, 0)
    if (total > 0) out[q.id] = Object.fromEntries(Object.entries(raw).map(([id, p]) => [id, p / total]))
  }
  return out
}

const FALLBACK_AS_OF = '2026-10-10T12:00:00Z'
const fallbackOdds = (): QuestionOdds => parseFutures(fallbackFutures as EspnFutures)

/**
 * Odds used for hot takes right now (before lock: latest snapshot; after: frozen). The bundled
 * copy is used only when no snapshot was ever stored, never to paper over a failed DB read: after
 * the lock that would silently change who qualified for a hot take.
 */
export async function getQuestionOdds(): Promise<{ odds: QuestionOdds; asOf: string; source: 'snapshot' | 'fallback' }> {
  // Before the lock the hand-captured markets are always the current ones; after it, only the
  // frozen snapshot counts (the cron stored them in it).
  const live = (odds: QuestionOdds) => (isLocked() ? odds : { ...odds, ...manualMarkets() })
  if (!process.env.DATABASE_URL) return { odds: live(fallbackOdds()), asOf: FALLBACK_AS_OF, source: 'fallback' }
  const snap = await kvGet<QuestionOdds>(ODDS_KV_KEY)
  if (snap && Object.keys(snap.value).length) return { odds: live(snap.value), asOf: snap.updatedAt, source: 'snapshot' }
  return { odds: live(fallbackOdds()), asOf: FALLBACK_AS_OF, source: 'fallback' }
}

/**
 * Called by the daily cron before the lock. Merges per market: a market ESPN dropped today keeps
 * its last known odds (reported in `carried`), so the snapshot frozen at lock is never partial.
 */
export async function refreshOddsSnapshot(
  season: number,
  userAgent: string,
): Promise<{ markets: number; carried: string[] }> {
  const res = await fetch(FUTURES_URL(season), {
    headers: { 'user-agent': userAgent, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ESPN futures ${res.status}`)
  const fresh = parseFutures((await res.json()) as EspnFutures)
  if (Object.keys(fresh).length === 0) throw new Error('ESPN futures: no market parsed')
  const prev = (await kvGet<QuestionOdds>(ODDS_KV_KEY))?.value ?? {}
  const base = Object.keys(prev).length ? prev : fallbackOdds()
  const merged: QuestionOdds = { ...base, ...fresh, ...manualMarkets() }
  const carried = QUESTIONS.filter((q) => q.futuresMarket && !fresh[q.id] && merged[q.id]).map((q) => q.id)
  // A run that started just before the lock must not write after it: the snapshot is frozen.
  if (isLocked()) throw new Error('locked: the odds snapshot is frozen')
  await kvSet(ODDS_KV_KEY, merged)
  return { markets: Object.keys(fresh).length, carried }
}
