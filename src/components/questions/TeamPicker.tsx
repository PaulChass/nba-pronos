'use client'

// Team questions use native radio buttons dressed as logo tiles: keyboard (arrow keys) and screen
// reader support come for free, and every team stays one tap away.
import type { PickerOption } from '@/lib/data'
import type { TeamAbbr } from '@/lib/types'
import { TEAM } from './logic'
import styles from './TeamPicker.module.css'

interface TeamPickerProps {
  /** Radio group name (one per question). */
  name: string
  options: readonly PickerOption[]
  value: string | null
  onChange: (id: string | null) => void
  labelledBy: string
  disabled?: boolean
}

export function TeamPicker({ name, options, value, onChange, labelledBy, disabled }: TeamPickerProps) {
  const current = value ? TEAM[value] : undefined
  return (
    <div className={styles.root}>
      <div role="radiogroup" aria-labelledby={labelledBy} className={styles.grid}>
        {options.map((o) => {
          const team = TEAM[o.id]
          const checked = value === o.id
          return (
            <label key={o.id} className={styles.tile} data-checked={checked} title={o.label}>
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(o.id)}
                className={styles.radio}
              />
              {team && <img src={team.logo} alt="" className="team-logo" loading="lazy" />}
              <span className={styles.abbr} aria-hidden>
                {team?.abbr ?? o.id}
              </span>
              <span className="visually-hidden">{o.label}</span>
            </label>
          )
        })}
      </div>
      {value && (
        <div className={styles.current}>
          <span>
            Ton choix : <strong>{current?.name ?? value}</strong>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} disabled={disabled}>
            Effacer
          </button>
        </div>
      )}
    </div>
  )
}

interface ChampionPickerProps {
  finalistE: TeamAbbr | null
  finalistW: TeamAbbr | null
  value: string | null
  onChange: (id: string | null) => void
  labelledBy: string
  disabled?: boolean
}

/** The champion must be one of the user's two finalists: two big buttons, nothing else. */
export function ChampionPicker({ finalistE, finalistW, value, onChange, labelledBy, disabled }: ChampionPickerProps) {
  const ready = !!finalistE && !!finalistW
  const hintId = `${labelledBy}-hint`
  const slots = [
    { conf: 'Est', abbr: finalistE },
    { conf: 'Ouest', abbr: finalistW },
  ]
  return (
    <div className={styles.root}>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={ready ? undefined : hintId}
        className={styles.champGrid}
      >
        {slots.map(({ conf, abbr }) => {
          const team = abbr ? TEAM[abbr] : undefined
          if (!abbr || !team)
            return (
              <div key={conf} className={`${styles.champTile} ${styles.champEmpty}`} aria-hidden>
                <span className={styles.champQ}>?</span>
                <span className="small muted">Finaliste {conf} à choisir</span>
              </div>
            )
          const checked = value === abbr
          return (
            <label key={conf} className={styles.champTile} data-checked={checked} data-disabled={!ready || !!disabled}>
              <input
                type="radio"
                name="champion"
                value={abbr}
                checked={checked}
                disabled={!ready || disabled}
                onChange={() => onChange(abbr)}
                className={styles.radio}
              />
              <img src={team.logo} alt="" className={`team-logo ${styles.champLogo}`} />
              <span className={styles.champName}>{team.shortName}</span>
              <span className="small muted">
                Finaliste {conf}
                <span className="visually-hidden"> : {team.name}</span>
              </span>
            </label>
          )
        })}
      </div>
      {!ready && (
        <p id={hintId} className="small muted">
          Choisis d’abord tes deux finalistes (Est et Ouest) : ton champion sera l’un des deux.
        </p>
      )}
      {value && (
        <div className={styles.current}>
          <span>
            Ton champion : <strong>{TEAM[value]?.name ?? value}</strong>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} disabled={disabled}>
            Effacer
          </button>
        </div>
      )}
    </div>
  )
}
