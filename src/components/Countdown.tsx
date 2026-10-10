// Shared module (no 'use client'): server pages call formatLockDate() directly, which would be
// impossible if this file were a client module (every export would become a client reference).
// The live clock itself is a client component, re-exported here under the public name.
export { CountdownClock as Countdown } from './CountdownClock'

const LOCK_DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
})

/** "mardi 20 octobre à 21h00" (Paris time, whatever the server's time zone). */
export function formatLockDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = Object.fromEntries(
    LOCK_DATE_FORMAT.formatToParts(date).map((x) => [x.type, x.value]),
  )
  const day = p.day === '1' ? '1er' : p.day
  return `${p.weekday} ${day} ${p.month} à ${p.hour}h${p.minute}`
}
