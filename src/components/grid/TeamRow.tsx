'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, type CSSProperties, type KeyboardEvent } from 'react'
import { SEASON } from '@/config/season'
import { formatLine, parseWinsInput, type GridTeam } from './grid-utils'
import styles from './GridEditor.module.css'

export interface RowHandlers {
  onWins(abbr: string, wins: number | null): void
  onStep(abbr: string, delta: number): void
  onMove(abbr: string, delta: -1 | 1): void
  onHot(abbr: string): void
  /** Enter in the wins field: jump to the next team. */
  onEnter(abbr: string): void
}

interface Props {
  team: GridTeam
  rank: number
  wins: number | null
  isFirst: boolean
  isLast: boolean
  /** Non-blocking warning (extreme value). */
  warning?: string
  /** Short name of the team ranked just above when this one has more wins than it. */
  violationAbove?: string
  line: number
  showLine: boolean
  hotOn: boolean
  /** Why the 🔥 toggle cannot be switched on right now (null = it can). */
  hotBlocked: string | null
  locked: boolean
  handlers: RowHandlers
}

function zoneClass(rank: number): string {
  // Top 6 = playoffs, 7-10 = play-in: a light visual cue on the rank number.
  return rank <= 6 ? styles.rankTop : rank <= 10 ? styles.rankPlayIn : styles.rankOut
}

export const TeamRow = memo(function TeamRow({
  team,
  rank,
  wins,
  isFirst,
  isLast,
  warning,
  violationAbove,
  line,
  showLine,
  hotOn,
  hotBlocked,
  locked,
  handlers,
}: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: team.abbr,
    disabled: locked,
    attributes: { roleDescription: 'équipe déplaçable' },
  })
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  const name = team.shortName
  const max = SEASON.gamesPerTeam
  const hotDisabled = locked || (!hotOn && hotBlocked !== null)

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handlers.onEnter(team.abbr)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      handlers.onStep(team.abbr, e.key === 'ArrowUp' ? 1 : -1)
    }
  }

  const className = [
    styles.row,
    isDragging && styles.dragging,
    violationAbove && styles.violation,
    hotOn && styles.hot,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li ref={setNodeRef} style={style} className={className} data-team={team.abbr}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.handle}
        {...attributes}
        {...listeners}
        aria-label={`Déplacer ${name} (rang ${rank})`}
        title="Maintiens et glisse pour déplacer"
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden focusable="false">
          {[3, 8, 13].flatMap((y) => [
            <circle key={`a${y}`} cx="2" cy={y} r="1.5" fill="currentColor" />,
            <circle key={`b${y}`} cx="8" cy={y} r="1.5" fill="currentColor" />,
          ])}
        </svg>
      </button>

      <span className={`${styles.rank} ${zoneClass(rank)}`} aria-hidden>
        {rank}
      </span>

      <div className={styles.team}>
        <img src={team.logo} alt="" className="team-logo" width={28} height={28} loading="lazy" decoding="async" />
        <span className={styles.name} title={team.name}>
          <span className="visually-hidden">{rank}. </span>
          {name}
        </span>
      </div>

      <div className={styles.stepper} role="group" aria-label={`Victoires : ${name}`}>
        <button
          type="button"
          className={styles.stepBtn}
          onClick={() => handlers.onStep(team.abbr, -1)}
          disabled={locked || wins === 0}
          aria-label={`Une victoire de moins pour ${name}`}
        >
          −
        </button>
        <input
          className={`${styles.winsInput} tabular`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={2}
          enterKeyHint={isLast ? 'done' : 'next'}
          placeholder="–"
          value={wins ?? ''}
          disabled={locked}
          data-wins-input={team.abbr}
          aria-label={`${name} : nombre de victoires`}
          aria-invalid={violationAbove ? true : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => handlers.onWins(team.abbr, parseWinsInput(e.currentTarget.value))}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={styles.stepBtn}
          onClick={() => handlers.onStep(team.abbr, 1)}
          disabled={locked || wins === max}
          aria-label={`Une victoire de plus pour ${name}`}
        >
          +
        </button>
      </div>

      <div className={styles.meta}>
        <span
          className={`${styles.record} tabular`}
          aria-label={wins === null ? 'Bilan pas encore rempli' : `Bilan : ${wins} victoires, ${max - wins} défaites`}
        >
          {wins === null ? 'V–D' : `${wins}–${max - wins}`}
        </span>
        {showLine && (
          <span className={styles.line} title="Ligne des bookmakers, ramenée à 1 230 victoires">
            Vegas <strong className="tabular">{formatLine(line)}</strong>
          </span>
        )}
      </div>

      <div className={styles.arrows}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => !isFirst && handlers.onMove(team.abbr, -1)}
          aria-disabled={locked || isFirst}
          disabled={locked}
          aria-label={`Monter ${name}`}
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => !isLast && handlers.onMove(team.abbr, 1)}
          aria-disabled={locked || isLast}
          disabled={locked}
          aria-label={`Descendre ${name}`}
        >
          ↓
        </button>
      </div>

      <div className={styles.fireCell}>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.fire}`}
          onClick={() => handlers.onHot(team.abbr)}
          aria-pressed={hotOn}
          aria-disabled={hotDisabled}
          disabled={locked}
          aria-label={hotOn ? `Retirer le hot take sur ${name}` : `Hot take sur ${name}`}
          title={hotOn ? 'Hot take déclaré' : (hotBlocked ?? 'Déclarer un hot take')}
        >
          <span aria-hidden>🔥</span>
        </button>
      </div>

      {(violationAbove || warning) && (
        <p className={styles.msg}>
          {violationAbove ? (
            <span className={styles.msgErr}>
              Plus de victoires que l’équipe classée au-dessus ({violationAbove}) : remonte-la ou baisse son total.
            </span>
          ) : (
            <span className={styles.msgWarn}>⚠ {warning}</span>
          )}
        </p>
      )}
    </li>
  )
})
