import type { AnswerKind, QuestionId } from '../lib/types.ts'

export interface QuestionDef {
  id: QuestionId
  /** Full French label shown on the questions page. */
  label: string
  /** Short label for tables, share image and leaderboard detail. */
  short: string
  kind: AnswerKind
  points: number
  /** When the answer becomes known (shown to players). */
  resolvesAt: string
  /** ESPN core award id (seasons/{y}/awards/{id}); absent when ESPN has no such award. */
  espnAwardId?: number
  /** Exact-prefix match of the ESPN futures market name, for the hot-take odds snapshot. */
  futuresMarket?: string
}

// Hardcoded on purpose (Paul's choice): edit this file to change the questions.
export const QUESTIONS: readonly QuestionDef[] = [
  { id: 'mvp', label: 'MVP de la saison régulière', short: 'MVP', kind: 'player', points: 20, resolvesAt: 'mi-mai', espnAwardId: 33, futuresMarket: 'NBA - Regular Season MVP' },
  { id: 'roy', label: 'Rookie de l’année (ROY)', short: 'ROY', kind: 'rookie', points: 20, resolvesAt: 'fin avril', espnAwardId: 35, futuresMarket: 'NBA - Rookie of the Year' },
  { id: 'dpoy', label: 'Défenseur de l’année (DPOY)', short: 'DPOY', kind: 'player', points: 20, resolvesAt: 'fin avril', espnAwardId: 39, futuresMarket: 'NBA - Defensive Player of the Year' },
  { id: 'smoy', label: '6e homme de l’année', short: '6MOY', kind: 'player', points: 20, resolvesAt: 'fin avril', espnAwardId: 40, futuresMarket: 'NBA - 6th Man of the Year' },
  { id: 'mip', label: 'Meilleure progression (MIP)', short: 'MIP', kind: 'player', points: 20, resolvesAt: 'fin avril', espnAwardId: 36, futuresMarket: 'NBA - Most Improved Player' },
  { id: 'clutch', label: 'Clutch Player of the Year', short: 'Clutch', kind: 'player', points: 20, resolvesAt: 'fin avril', espnAwardId: 297 },
  { id: 'coy', label: 'Coach de l’année', short: 'COY', kind: 'coach', points: 20, resolvesAt: 'fin avril', futuresMarket: 'NBA - Coach of the Year' },
  { id: 'scoring', label: 'Meilleur marqueur (points par match)', short: 'Top scoreur', kind: 'player', points: 20, resolvesAt: 'mi-avril' },
  { id: 'cup', label: 'Vainqueur de la NBA Cup', short: 'NBA Cup', kind: 'team', points: 20, resolvesAt: '11 décembre', futuresMarket: 'NBA - In-Season Tournament Winner' },
  { id: 'finalistE', label: 'Finaliste de l’Est', short: 'Finaliste Est', kind: 'teamE', points: 20, resolvesAt: 'fin mai', futuresMarket: 'NBA - Eastern Conference - Winner' },
  { id: 'finalistW', label: 'Finaliste de l’Ouest', short: 'Finaliste Ouest', kind: 'teamW', points: 20, resolvesAt: 'fin mai', futuresMarket: 'NBA - Western Conference - Winner' },
  { id: 'champion', label: 'Champion NBA', short: 'Champion', kind: 'champion', points: 30, resolvesAt: 'juin', futuresMarket: 'NBA - Winner' },
  { id: 'fmvp', label: 'MVP des Finales', short: 'MVP Finales', kind: 'player', points: 20, resolvesAt: 'juin', espnAwardId: 43 },
]

export const QUESTION_BY_ID: Record<QuestionId, QuestionDef> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q]),
) as Record<QuestionId, QuestionDef>

export const QUESTIONS_MAX_POINTS = QUESTIONS.reduce((sum, q) => sum + q.points, 0)
