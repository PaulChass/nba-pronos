import type { ReactNode } from 'react'
import type { ScoreCard } from '@/lib/types'
import { ordinal, pts } from './format'
import styles from './score.module.css'

/** Player page header: pseudo, general rank, total and the three sub-scores. */
export function ScoreHeader({
  card,
  nPlayers,
  isOwner,
  children,
}: {
  card: ScoreCard
  nPlayers: number
  isOwner: boolean
  children?: ReactNode
}) {
  return (
    <section className={`card ${styles.header}`} aria-labelledby="player-title">
      <div className={styles.headTop}>
        <div className={styles.headWho}>
          <h1 id="player-title" className={styles.pseudoTitle}>
            {card.pseudo}
          </h1>
          <p className={styles.headRank}>
            <strong>{ordinal(card.rank)}</strong> sur {nPlayers} au général
            {isOwner && <span className={`badge ${styles.tag}`}>toi</span>}
            {!card.gridValid && <span className={`badge ${styles.tag} ${styles.incomplete}`}>grille incomplète</span>}
          </p>
        </div>
        <p className={styles.total}>
          <span className={styles.totalValue}>{card.total}</span>
          <span className={styles.totalUnit}>pts</span>
        </p>
      </div>

      <dl className={styles.tiles}>
        <div>
          <dt>Grille</dt>
          <dd>{card.grid}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{card.questions}</dd>
        </div>
        <div>
          <dt>Hot takes</dt>
          <dd>{card.hotTakes}</dd>
        </div>
      </dl>

      <p className="small muted">
        Général = grille + questions + hot takes. Encore jouables : <strong>{pts(card.stillPlayable)}</strong>{' '}
        (questions en attente et leurs hot takes).
      </p>
      {children}
    </section>
  )
}
