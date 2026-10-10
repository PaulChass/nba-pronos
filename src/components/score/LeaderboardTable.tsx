import Link from 'next/link'
import type { ScoreCard } from '@/lib/types'
import { gridBreakdown, hotTakesBreakdown, questionsBreakdown } from './explain'
import { plural } from './format'
import { viewRows, type LeaderboardView } from './views'
import styles from './score.module.css'

const POINTS_HEADER: Record<LeaderboardView, string> = {
  general: 'Total',
  grille: 'Grille',
  questions: 'Questions',
  'hot-takes': 'Hot takes',
}

/** The small line under each pseudo: where this view's points come from. */
function detailLine(card: ScoreCard, view: LeaderboardView): string {
  switch (view) {
    case 'grille': {
      const b = gridBreakdown(card)
      return `Victoires ${b.win} · Rangs ${b.rank}`
    }
    case 'questions': {
      const b = questionsBreakdown(card)
      return `${plural(b.correct, 'bonne réponse', 'bonnes réponses')} · ${b.pending} en attente`
    }
    case 'hot-takes': {
      const b = hotTakesBreakdown(card)
      if (b.declared === 0) return 'Aucun hot take déclaré'
      return `${plural(b.eligible, 'retenu', 'retenus')} sur ${b.declared} · ${plural(b.winning, 'gagnant', 'gagnants')}`
    }
    default:
      return `Grille ${card.grid} · Questions ${card.questions} · Hot takes ${card.hotTakes}`
  }
}

export function playerHref(pseudo: string): string {
  return `/joueur/${encodeURIComponent(pseudo)}`
}

/** One leaderboard view. The signed-in player's row is highlighted. */
export function LeaderboardTable({
  cards,
  view,
  meId,
}: {
  cards: readonly ScoreCard[]
  view: LeaderboardView
  meId: number | null
}) {
  const rows = viewRows(cards, view)
  const general = view === 'general'
  return (
    <table className={`table ${styles.board}`}>
      <caption className="visually-hidden">Classement {POINTS_HEADER[view].toLowerCase()}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">
            <abbr title="Rang">#</abbr>
          </th>
          <th scope="col">Joueur</th>
          <th scope="col" className="num">
            {POINTS_HEADER[view]}
          </th>
          {general && (
            <th scope="col" className={`num ${styles.playableHead}`}>
              Encore jouables
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ card, points, rank, tied }) => {
          const me = card.userId === meId
          return (
            <tr key={card.userId} className={me ? styles.me : undefined} aria-current={me ? 'true' : undefined}>
              <td className={`num ${styles.rank} ${rank <= 3 ? styles.podium : ''}`}>
                {rank}
                {tied && <span className="visually-hidden"> (ex æquo)</span>}
              </td>
              <th scope="row" className={styles.player}>
                <Link href={playerHref(card.pseudo)} className={styles.pseudo}>
                  {card.pseudo}
                </Link>
                {me && <span className={`badge ${styles.tag}`}>toi</span>}
                {!card.gridValid && <span className={`badge ${styles.tag} ${styles.incomplete}`}>grille incomplète</span>}
                <span className={styles.sub}>{detailLine(card, view)}</span>
              </th>
              <td className={`num ${styles.points}`}>{points}</td>
              {general && <td className={`num ${styles.playable}`}>{card.stillPlayable}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
