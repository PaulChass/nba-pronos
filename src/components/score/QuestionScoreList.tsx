import { QUESTIONS, type QuestionDef } from '@/config/questions'
import { answerLabel } from '@/lib/data'
import type { LockContext } from '@/lib/scoring'
import type { QuestionResult, QuestionScore, Results } from '@/lib/types'
import { Chip, HotTakeBox } from './Chip'
import { deadExplain, questionHotTakeView, questionStatus } from './explain'
import { pts } from './format'
import styles from './score.module.css'

/** The 13 answers with their status, the official result and the points it gives. */
export function QuestionScoreList({
  qs,
  results,
  ctx,
}: {
  qs: readonly QuestionScore[]
  results: Results
  ctx: Pick<LockContext, 'odds' | 'pickCounts'>
}) {
  const byId = new Map(qs.map((q) => [q.id, q]))
  return (
    <ol className={styles.list}>
      {QUESTIONS.map((def) => {
        const q = byId.get(def.id)
        if (!q) return null
        return (
          <QuestionRow
            key={def.id}
            def={def}
            q={q}
            result={results[def.id]}
            market={ctx.odds[def.id]}
            pickCount={q.pick ? ctx.pickCounts[def.id]?.[q.pick] : undefined}
          />
        )
      })}
    </ol>
  )
}

function outcome(def: QuestionDef, q: QuestionScore, result: QuestionResult | undefined): string {
  if (q.status === 'void') return 'Trophée non décerné : question annulée pour tout le monde.'
  if (q.dead) return deadExplain(q)
  if (q.status === 'pending' || result?.status !== 'final') return `Résultat attendu : ${def.resolvesAt}.`
  const winners = result.winners.map((w) => answerLabel(def.kind, w)).join(' / ')
  const label = result.winners.length > 1 ? 'Co-vainqueurs' : 'Réponse'
  if (!q.pick) return `${label} : ${winners}.`
  return `${label} : ${winners}, donc ${q.correct ? `+${pts(q.points)}` : '0 pt'}.`
}

function QuestionRow({
  def,
  q,
  result,
  market,
  pickCount,
}: {
  def: QuestionDef
  q: QuestionScore
  result: QuestionResult | undefined
  market: Record<string, number> | undefined
  pickCount: number | undefined
}) {
  const pickLabel = answerLabel(def.kind, q.pick)
  const hotTake = questionHotTakeView(q, pickLabel, market, pickCount)
  // Undecided or void: no score yet, shown as a dash (the engine reports 0 / maxPoints 0 for void).
  const noScore = q.status !== 'final'
  // A pick that can no longer score (spec §5.4) is greyed out.
  return (
    <li className={q.dead ? `${styles.item} ${styles.itemDead}` : styles.item}>
      <div className={`${styles.itemMain} ${styles.itemMainBare}`}>
        <div className={styles.info}>
          <span className={styles.qLabel}>{def.label}</span>
          <span className={styles.name}>{q.pick ? pickLabel : 'Pas de réponse'}</span>
        </div>
        <span className={styles.score}>
          {noScore ? (
            <>
              <span aria-hidden>–</span>
              <span className="visually-hidden">
                {q.status === 'void' ? 'annulée' : q.dead ? 'éliminé' : 'en attente'}
              </span>
            </>
          ) : (
            q.points
          )}
          <small>/{def.points}</small>
        </span>
      </div>
      <div className={styles.chips}>
        <Chip chip={questionStatus(q)} />
        <span className={styles.detail}>{outcome(def, q, result)}</span>
      </div>
      {hotTake && <HotTakeBox view={hotTake} />}
    </li>
  )
}
