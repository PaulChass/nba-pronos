// Date formatting for the admin page: always Paris time, whatever the server's time zone.
const TZ = 'Europe/Paris'
const day = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short' })
const dayTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const full = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' })

function safe(fmt: Intl.DateTimeFormat, iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : fmt.format(d)
}

/** "12 oct." */
export const parisDay = (iso: string | null | undefined) => safe(day, iso)
/** "12 oct., 21:04" */
export const parisDayTime = (iso: string | null | undefined) => safe(dayTime, iso)
/** "12 oct. 2026, 21:04" */
export const parisFull = (iso: string | null | undefined) => safe(full, iso)

/** plural(3, 'joueur', 'joueurs') -> "3 joueurs" */
export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
