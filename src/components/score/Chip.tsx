import type { Chip as ChipData, HotTakeView, Tone } from './explain'
import styles from './score.module.css'

const TONE_CLASS: Record<Tone, string> = {
  ok: styles.chipOk,
  warn: styles.chipWarn,
  err: styles.chipErr,
  neutral: styles.chipNeutral,
}

/** Small state pill: "en bonne voie", "bonne réponse", "réussi +10"… */
export function Chip({ chip }: { chip: ChipData }) {
  return <span className={`${styles.chip} ${TONE_CLASS[chip.tone]}`}>{chip.label}</span>
}

/** 🔥 badge. Decorative emoji, readable label. */
export function FireBadge({ label = 'Hot take' }: { label?: string }) {
  return (
    <span className="badge badge-fire">
      <span aria-hidden>🔥</span> {label}
    </span>
  )
}

/** A declared hot take: template caption, state, and the numbers behind the state. */
export function HotTakeBox({ view, className }: { view: HotTakeView; className?: string }) {
  return (
    <div className={`${styles.hotTake} ${className ?? ''}`}>
      <div className={styles.chips}>
        <FireBadge />
        <Chip chip={view.chip} />
      </div>
      <p className={styles.caption}>{view.caption}</p>
      <p className={styles.detail}>{view.detail}</p>
    </div>
  )
}
