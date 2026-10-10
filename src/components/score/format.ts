// Display helpers for scores. Pure (no React, no Next, no JSON): usable in tests and anywhere.

const DECIMAL = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

const PARIS_DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
})

/** 1 -> "1er", 4 -> "4e". */
export function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`
}

/** Rank range shared by teams with identical records: [3, 4] -> "3e–4e", [3, 3] -> "3e". */
export function rankRangeLabel([lo, hi]: readonly [number, number]): string {
  return lo === hi ? ordinal(lo) : `${ordinal(lo)}–${ordinal(hi)}`
}

/** French decimal with at most one digit: 45.94 -> "45,9", 46 -> "46". */
export function dec(n: number): string {
  return DECIMAL.format(n)
}

/** Rounded and signed, with a real minus sign: 11.4 -> "+11", -4 -> "−4", 0 -> "0". */
export function signed(n: number): string {
  const r = Math.round(n)
  if (r > 0) return `+${r}`
  if (r < 0) return `−${-r}`
  return '0'
}

/** "0 pt", "1 pt", "16 pts". */
export function pts(n: number): string {
  return `${n} pt${Math.abs(n) > 1 ? 's' : ''}`
}

/** "1 bonne réponse", "3 bonnes réponses" (regular plurals only). */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`
}

/** Probability as a whole percentage: 0.123 -> "12 %", 0.004 -> "< 1 %". */
export function pct(p: number): string {
  const v = Math.round(p * 100)
  return v < 1 ? '< 1 %' : `${v} %`
}

/** "12 novembre à 8h30", Paris time whatever the server's time zone. */
export function parisDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = Object.fromEntries(
    PARIS_DATE_TIME.formatToParts(date).map((x) => [x.type, x.value]),
  )
  const day = p.day === '1' ? '1er' : p.day
  return `${day} ${p.month} à ${p.hour}h${p.minute}`
}
