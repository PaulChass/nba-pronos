// Read-only view of the owner's own prediction before the lock (no points yet, no Vegas lines:
// they stay hidden by default while predictions can still change).
import { QUESTIONS } from '@/config/questions'
import { SEASON } from '@/config/season'
import { answerLabel, TEAM_BY_ABBR } from '@/lib/data'
import type { Answers, Conf, GridPrediction, HotTakes } from '@/lib/types'
import { CONFS } from '@/lib/validation'
import { FireBadge } from './Chip'
import { ordinal } from './format'
import styles from './score.module.css'

const CONF_LABEL: Record<Conf, string> = { E: 'Est', W: 'Ouest' }

export function GridReadOnly({ grid, hotTakes }: { grid: GridPrediction; hotTakes: HotTakes }) {
  return (
    <>
      {CONFS.map((conf) => (
        <section key={conf} aria-labelledby={`own-conf-${conf}`} className={styles.confSection}>
          <div className={styles.sectionHead}>
            <h3 id={`own-conf-${conf}`} className={styles.confTitle}>
              <span className={`badge ${conf === 'E' ? 'badge-east' : 'badge-west'}`}>{CONF_LABEL[conf]}</span>
            </h3>
          </div>
          <ol className={styles.list}>
            {grid.order[conf].map((abbr, i) => {
              const team = TEAM_BY_ABBR[abbr]
              const w = grid.wins[abbr]
              return (
                <li key={abbr} className={styles.item}>
                  <div className={styles.itemMain}>
                    <span className={styles.pos} aria-hidden>
                      {i + 1}
                    </span>
                    {team ? <img src={team.logo} alt="" className="team-logo" width={28} height={28} loading="lazy" /> : <span />}
                    <div className={styles.info}>
                      <span className={styles.name}>
                        {team?.shortName ?? abbr}{' '}
                        {hotTakes.teams.includes(abbr) && <FireBadge />}
                      </span>
                      <span className={styles.nums}>
                        {ordinal(i + 1)} · {w === null || w === undefined ? 'victoires à remplir' : `${w}-${SEASON.gamesPerTeam - w}`}
                      </span>
                    </div>
                    <span className={styles.score}>
                      {w ?? '–'}
                      <small>V</small>
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </>
  )
}

export function AnswersReadOnly({ answers, hotTakes }: { answers: Answers; hotTakes: HotTakes }) {
  return (
    <ol className={styles.list}>
      {QUESTIONS.map((q) => (
        <li key={q.id} className={styles.item}>
          <div className={`${styles.itemMain} ${styles.itemMainBare}`}>
            <div className={styles.info}>
              <span className={styles.qLabel}>{q.label}</span>
              <span className={styles.name}>
                {answers[q.id] ? answerLabel(q.kind, answers[q.id]) : <span className="muted">Pas encore de réponse</span>}{' '}
                {hotTakes.questions.includes(q.id) && <FireBadge />}
              </span>
            </div>
            <span className={`${styles.score} ${styles.scoreMuted}`}>
              {q.points}
              <small>pts</small>
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
