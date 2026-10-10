import { SEASON } from '@/config/season'
import { TEAM_BY_ABBR } from '@/lib/data'
import type { Conf, TeamAbbr, TeamScore, TeamStanding } from '@/lib/types'
import { Chip, HotTakeBox } from './Chip'
import {
  projectionExplain,
  rankPtsExplain,
  teamHotTakeView,
  teamStatus,
  winPtsExplain,
} from './explain'
import { dec, ordinal, pts, rankRangeLabel } from './format'
import styles from './score.module.css'

const CONF_LABEL: Record<Conf, string> = { E: 'Est', W: 'Ouest' }

/**
 * One conference of a scored grid, in the player's predicted order. Every point is explained:
 * the win formula with its numbers, the rank comparison, and where the "actual" wins come from.
 */
export function TeamScoreList({
  conf,
  teams,
  standings,
  medians,
  final,
}: {
  conf: Conf
  teams: readonly TeamScore[]
  standings: Partial<Record<TeamAbbr, TeamStanding>>
  /** Median of the other players' wins per team (null when the group is too small). */
  medians: Partial<Record<TeamAbbr, number | null>> | undefined
  final: boolean
}) {
  const list = teams.filter((t) => t.conference === conf).sort((a, b) => a.predictedRank - b.predictedRank)
  const subtotal = list.reduce((s, t) => s + t.winPts + t.rankPts, 0)
  const headingId = `conf-${conf}`
  return (
    <section aria-labelledby={headingId} className={styles.confSection}>
      <div className={styles.sectionHead}>
        <h3 id={headingId} className={styles.confTitle}>
          <span className={`badge ${conf === 'E' ? 'badge-east' : 'badge-west'}`}>{CONF_LABEL[conf]}</span>
        </h3>
        <span className={styles.subtotal}>{pts(subtotal)}</span>
      </div>
      <ol className={styles.list}>
        {list.map((t) => (
          <TeamRow key={t.abbr} t={t} standing={standings[t.abbr]} median={medians?.[t.abbr]} final={final} />
        ))}
      </ol>
    </section>
  )
}

function TeamRow({
  t,
  standing,
  median,
  final,
}: {
  t: TeamScore
  standing: TeamStanding | undefined
  median: number | null | undefined
  final: boolean
}) {
  const team = TEAM_BY_ABBR[t.abbr]
  const name = team?.shortName ?? t.abbr
  const status = teamStatus(t, final)
  const hotTake = teamHotTakeView(t, name, median, final)
  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        <span className={styles.pos} aria-hidden>
          {t.predictedRank}
        </span>
        {team ? <img src={team.logo} alt="" className="team-logo" width={28} height={28} loading="lazy" /> : <span />}
        <div className={styles.info}>
          <span className={styles.name}>{name}</span>
          <span className={styles.nums}>
            Prono <strong>{t.predictedWins} V</strong> ({ordinal(t.predictedRank)}) · {final ? 'Réel' : 'Proj.'}{' '}
            <strong>{t.actualWins} V</strong> ({rankRangeLabel(t.actualRank)})
          </span>
        </div>
        <span className={styles.score}>
          {t.winPts + t.rankPts}
          <small>pts</small>
        </span>
      </div>

      {status && (
        <div className={`${styles.chips} ${styles.indent}`}>
          <Chip chip={status} />
        </div>
      )}

      <details className={`${styles.explain} ${styles.indent}`}>
        <summary>
          Le calcul : {t.winPts} + {t.rankPts}
        </summary>
        <ul>
          <li>
            Victoires : <span className={styles.formula}>{winPtsExplain(t)}</span>
          </li>
          <li>Rang : {rankPtsExplain(t, final)}</li>
          {projectionExplain(standing, t.line, t.actualWins, final).map((line, i) => (
            <li key={i} className={i > 0 ? styles.formula : undefined}>
              {line}
            </li>
          ))}
          <li>
            Ligne Vegas ramenée à {SEASON.totalWins.toLocaleString('fr-FR')} victoires : {dec(t.line)} V
          </li>
        </ul>
      </details>

      {hotTake && <HotTakeBox view={hotTake} className={styles.indent} />}
    </li>
  )
}
