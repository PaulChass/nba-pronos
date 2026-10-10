// "Mes points expliqués": turns engine output into the French sentences shown next to each point.
// Pure (relative .ts imports, no JSON) so it is unit-tested with `node --test`.
// The engine (lib/scoring.ts) stays the source of truth: these helpers only display its numbers
// and never award points themselves.
import { SCORING } from '../../config/scoring.ts'
import { SEASON } from '../../config/season.ts'
import { teamHotTakeCaption } from '../../lib/scoring.ts'
import type { QuestionScore, ScoreCard, TeamScore, TeamStanding } from '../../lib/types.ts'
import { dec, ordinal, pct, plural, rankRangeLabel } from './format.ts'

export type Tone = 'ok' | 'warn' | 'err' | 'neutral'

export interface Chip {
  label: string
  tone: Tone
}

/** A declared hot take, explained: template caption, state chip, numbers behind the state. */
export interface HotTakeView {
  caption: string
  chip: Chip
  detail: string
}

/** UI-only thresholds for the live team status (win points, out of SCORING.winBase). */
export const ON_TRACK_MIN = 15
export const IN_DANGER_MAX = 5

// ---------------------------------------------------------------- grid

/** "en bonne voie" / "en danger" while the season runs; nothing once the grid is final. */
export function teamStatus(t: TeamScore, final: boolean): Chip | null {
  if (final) return null
  if (t.winPts >= ON_TRACK_MIN) return { label: 'en bonne voie', tone: 'ok' }
  if (t.winPts <= IN_DANGER_MAX) return { label: 'en danger', tone: 'err' }
  return null
}

/** "20 − |50 − 46| = 16". */
export function winPtsExplain(t: TeamScore): string {
  const formula = `${SCORING.winBase} − |${t.predictedWins} − ${t.actualWins}|`
  return SCORING.winBase - Math.abs(t.predictedWins - t.actualWins) >= 0
    ? `${formula} = ${t.winPts}`
    : `${formula} est négatif, donc ${t.winPts}`
}

/** "prono 4e, projection 3e–4e : exact, +5 (bilans identiques : bénéfice du doute)". */
export function rankPtsExplain(t: TeamScore, final: boolean): string {
  const ref = `${final ? 'classement final' : 'projection'} ${rankRangeLabel(t.actualRank)}`
  const verdict =
    t.rankPts >= SCORING.rankExact
      ? `exact, +${t.rankPts}`
      : t.rankPts > 0
        ? `à une place près, +${t.rankPts}`
        : 'trop loin, 0'
  const tie = t.actualRank[0] !== t.actualRank[1] ? ' (bilans identiques : bénéfice du doute)' : ''
  return `prono ${ordinal(t.predictedRank)}, ${ref} : ${verdict}${tie}`
}

/**
 * Where the "actual" wins come from. During the season: the projection with its numbers
 * (only when our recomputation matches the engine, so we never show a formula that disagrees).
 */
export function projectionExplain(
  standing: Pick<TeamStanding, 'w' | 'l'> | undefined,
  line: number,
  actual: number,
  final: boolean,
): string[] {
  if (!standing) return [`${actual} V retenues pour le calcul.`]
  const { w, l } = standing
  if (final) return [`Bilan final ${w}-${l} : ${actual} V retenues.`]
  const gp = w + l
  const rest = SEASON.gamesPerTeam - gp
  const K = SCORING.projectionK
  if (gp === 0) return [`Pas encore de match : la projection vaut la ligne Vegas (${dec(line)} V), soit ${actual} V.`]
  const lines = [
    `Bilan actuel ${w}-${l} après ${plural(gp, 'match', 'matchs')}. Les ${rest} matchs restants sont projetés au rythme actuel, mêlé à la ligne Vegas (${dec(line)} V) qui compte de moins en moins.`,
  ]
  const mine = Math.round(w + (rest * (w + (K * line) / SEASON.gamesPerTeam)) / (gp + K))
  if (mine === actual)
    lines.push(`arrondi(${w} + ${rest} × (${w} + ${K} × ${dec(line)} / ${SEASON.gamesPerTeam}) / (${gp} + ${K})) = ${actual} V`)
  else lines.push(`Projection : ${actual} V.`)
  return lines
}

/** Team hot take: "Spurs à 70 V : +11 sur Vegas, +12 sur le groupe" + its state. */
export function teamHotTakeView(
  t: TeamScore,
  teamName: string,
  median: number | null | undefined,
  final: boolean,
): HotTakeView | null {
  const ht = t.hotTake
  if (!ht) return null
  const P = t.predictedWins
  const L = t.line
  const M = median ?? null
  // Same template as the rules page and the share image (engine-owned).
  const caption = teamHotTakeCaption(teamName, P, L, M)
  const noGroup = M === null ? ` Moins de ${SCORING.htGroupMinOthers} autres grilles : pas de test du groupe.` : ''

  if (!ht.eligible) {
    const why = Math.abs(P - L) < SCORING.htTeamMinGap ? 'pas assez d’écart avec Vegas' : 'le groupe pensait comme toi'
    return {
      caption,
      chip: { label: `non retenu (${why})`, tone: 'neutral' },
      detail: `Il fallait au moins ${SCORING.htTeamMinGap} victoires d’écart avec Vegas (${dec(L)} V)${M === null ? '' : ` et avec la médiane des autres joueurs (${dec(M)} V), du même côté`}. Ça ne coûte rien.${noGroup}`,
    }
  }

  const A = t.actualWins
  const gaps =
    `Écart avec ${final ? 'le bilan final' : 'la projection'} (${A} V) : prono ${Math.abs(P - A)}, ` +
    `Vegas ${dec(Math.abs(L - A))}${M === null ? '' : `, groupe ${dec(Math.abs(M - A))}`}.${noGroup}`
  if (final)
    return ht.success
      ? { caption, chip: { label: `réussi +${ht.bonus}`, tone: 'ok' }, detail: `${gaps} Le prono est le plus proche.` }
      : { caption, chip: { label: 'raté', tone: 'err' }, detail: `${gaps} Il fallait être strictement le plus proche.` }
  return {
    caption,
    chip: { label: 'en cours', tone: 'warn' },
    detail: `${gaps} Si la saison s’arrêtait ce soir : ${ht.success ? `réussi (+${SCORING.htTeamBonus})` : 'raté'}.`,
  }
}

// ---------------------------------------------------------------- questions

export function questionStatus(q: QuestionScore): Chip {
  if (q.status === 'void') return { label: 'annulée', tone: 'neutral' }
  if (!q.pick) return { label: 'pas de réponse', tone: 'neutral' }
  if (q.status === 'pending') return { label: 'en attente', tone: 'warn' }
  return q.correct ? { label: 'bonne réponse', tone: 'ok' } : { label: 'raté', tone: 'err' }
}

/**
 * Question hot take: "Wembanyama : 8 % selon les bookmakers (favori à 32 %), choisi par
 * personne d’autre" + its state. `market` = de-vigged odds at lock, `pickCount` = players who
 * made this pick (the owner included).
 */
export function questionHotTakeView(
  q: QuestionScore,
  pickLabel: string,
  market: Record<string, number> | undefined,
  pickCount: number | undefined,
): HotTakeView | null {
  const ht = q.hotTake
  if (!ht || !q.pick) return null
  const probs = market ? Object.values(market) : []
  const fav = probs.length ? Math.max(...probs) : null
  const p = market?.[q.pick]
  const oddsTxt =
    fav === null
      ? 'pas de cote pour cette question'
      : p === undefined
        ? `hors cote chez les bookmakers (favori à ${pct(fav)})`
        : `${pct(p)} selon les bookmakers (favori à ${pct(fav)})`
  const others = Math.max(0, (pickCount ?? 1) - 1)
  const groupTxt = others === 0 ? 'choisi par personne d’autre' : `choisi aussi par ${plural(others, 'autre joueur', 'autres joueurs')}`
  const caption = `${pickLabel} : ${oddsTxt}, ${groupTxt}`

  if (!ht.eligible) {
    // Mirrors the odds half of the test (validation.questionHotTakeAllowed) to name the reason.
    const oddsOk = fav === null || (p ?? Math.min(...probs)) <= fav / SCORING.htOddsRatio
    return {
      caption,
      chip: { label: `non retenu (${oddsOk ? 'le groupe pensait comme toi' : 'les bookmakers y croyaient trop'})`, tone: 'neutral' },
      detail:
        fav === null
          ? 'Sans cote, personne d’autre ne devait faire ce choix. Ça ne coûte rien.'
          : `Il fallait un choix au moins ${SCORING.htOddsRatio} fois moins probable que le favori, fait par au plus 1 autre joueur sur ${SCORING.htGroupShareDivisor}. Ça ne coûte rien.`,
    }
  }
  if (q.status === 'void') return { caption, chip: { label: 'annulée', tone: 'neutral' }, detail: 'Question annulée pour tout le monde.' }
  if (q.status === 'pending')
    return { caption, chip: { label: 'en cours', tone: 'warn' }, detail: `Si la réponse tombe : ${q.maxPoints} pts doublés (+${q.maxPoints}).` }
  return q.correct
    ? { caption, chip: { label: `réussi +${ht.bonus}`, tone: 'ok' }, detail: `Bonne réponse : ${q.maxPoints} pts doublés.` }
    : { caption, chip: { label: 'raté', tone: 'err' }, detail: 'Mauvaise réponse : pas de bonus, rien de perdu.' }
}

// ---------------------------------------------------------------- per-card summaries

export function gridBreakdown(card: ScoreCard): { win: number; rank: number } {
  let win = 0
  let rank = 0
  for (const t of card.teams) {
    win += t.winPts
    rank += t.rankPts
  }
  return { win, rank }
}

export function questionsBreakdown(card: ScoreCard): { correct: number; pending: number } {
  let correct = 0
  let pending = 0
  for (const q of card.qs) {
    if (q.correct === true) correct++
    else if (q.status === 'pending' && q.pick) pending++
  }
  return { correct, pending }
}

/** Declared hot takes, how many qualified at lock, and how many are scoring right now. */
export function hotTakesBreakdown(card: ScoreCard): { declared: number; eligible: number; winning: number } {
  const all = [...card.teams.map((t) => t.hotTake), ...card.qs.map((q) => q.hotTake)].filter((h) => h !== null)
  return {
    declared: all.length,
    eligible: all.filter((h) => h.eligible).length,
    winning: all.filter((h) => h.eligible && h.success).length,
  }
}
