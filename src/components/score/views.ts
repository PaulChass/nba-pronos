// Leaderboard views (Général, Grille, Questions, Hot takes). Pure: unit-tested with `node --test`.
import type { ScoreCard } from '../../lib/types.ts'

export type LeaderboardView = 'general' | 'grille' | 'questions' | 'hot-takes'

export const LEADERBOARD_VIEWS: readonly { id: LeaderboardView; label: string }[] = [
  { id: 'general', label: 'Général' },
  { id: 'grille', label: 'Grille' },
  { id: 'questions', label: 'Questions' },
  { id: 'hot-takes', label: 'Hot takes' },
]

/** `?vue=` value -> view (anything unknown falls back to Général). */
export function parseView(raw: string | string[] | undefined): LeaderboardView {
  const v = Array.isArray(raw) ? raw[0] : raw
  return LEADERBOARD_VIEWS.find((x) => x.id === v)?.id ?? 'general'
}

export function viewPoints(card: ScoreCard, view: LeaderboardView): number {
  switch (view) {
    case 'grille':
      return card.grid
    case 'questions':
      return card.questions
    case 'hot-takes':
      return card.hotTakes
    default:
      return card.total
  }
}

export interface ViewRow {
  card: ScoreCard
  points: number
  rank: number
  /** Shares its rank with another player (sub-rankings only). */
  tied: boolean
}

/**
 * Général keeps the engine's strict order (tie-breaks: grid, oldest last save, pseudo).
 * Sub-rankings have no official tie-break: equal points share a rank, listed in general order.
 */
export function viewRows(cards: readonly ScoreCard[], view: LeaderboardView): ViewRow[] {
  const byGeneral = [...cards].sort((a, b) => a.rank - b.rank)
  if (view === 'general') return byGeneral.map((card) => ({ card, points: card.total, rank: card.rank, tied: false }))
  const rows = byGeneral.map((card) => ({ card, points: viewPoints(card, view) }))
  rows.sort((a, b) => b.points - a.points) // stable: equal points keep the general order
  return rows.map((r) => ({
    ...r,
    rank: 1 + rows.filter((x) => x.points > r.points).length,
    tied: rows.filter((x) => x.points === r.points).length > 1,
  }))
}
