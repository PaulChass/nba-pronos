// Pure helpers for the grid editor (no React, no Next, no JSON) so they can be unit-tested with
// `node --test`. Every function returns the same object when nothing changes, which lets the
// editor skip no-op saves.

import { SEASON } from '../../config/season.ts'
import type { Conf, GridPrediction, TeamAbbr } from '../../lib/types.ts'

/** What the editor needs to know about a team (plain data, passed from the server page). */
export interface GridTeam {
  abbr: TeamAbbr
  name: string
  shortName: string
  logo: string
  conference: Conf
}

export const CONF_LABEL: Record<Conf, string> = { E: 'Est', W: 'Ouest' }

const MAX_WINS = SEASON.gamesPerTeam

/** What the user typed → wins value: digits only, '' → null, clamped to 0..82. */
export function parseWinsInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  return Math.min(MAX_WINS, Number(digits))
}

/** +/− buttons. An empty value starts from the league average (41), not from the Vegas line. */
export function stepWins(current: number | null, delta: number): number {
  if (current === null) return Math.round(MAX_WINS / 2)
  return Math.max(0, Math.min(MAX_WINS, current + delta))
}

export function withWins(grid: GridPrediction, abbr: TeamAbbr, wins: number | null): GridPrediction {
  if (grid.wins[abbr] === wins) return grid
  return { ...grid, wins: { ...grid.wins, [abbr]: wins } }
}

export function moveTeam(grid: GridPrediction, conf: Conf, from: number, to: number): GridPrediction {
  const list = grid.order[conf]
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return grid
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return { ...grid, order: { ...grid.order, [conf]: next } }
}

/**
 * "Reclasser": moves one team to the place its wins give it in its conference: just before the
 * first team (in the current order) with fewer wins or no value yet; equal records stay above it.
 */
export function reclassTeam(grid: GridPrediction, conf: Conf, abbr: TeamAbbr): GridPrediction {
  const w = grid.wins[abbr]
  if (w === null || w === undefined) return grid
  const rest = grid.order[conf].filter((a) => a !== abbr)
  let i = rest.findIndex((a) => {
    const x = grid.wins[a]
    return x === null || x === undefined || x < w
  })
  if (i < 0) i = rest.length
  const next = [...rest.slice(0, i), abbr, ...rest.slice(i)]
  if (next.every((a, j) => a === grid.order[conf][j])) return grid
  return { ...grid, order: { ...grid.order, [conf]: next } }
}

/** "Trier par victoires": most wins first; ties keep their current order; empty values go last. */
export function sortConfByWins(grid: GridPrediction, conf: Conf): GridPrediction {
  const list = grid.order[conf]
  const sorted = list
    .map((abbr, i) => ({ abbr, i, w: grid.wins[abbr] ?? null }))
    .sort((a, b) => {
      if (a.w === null || b.w === null) return a.w === b.w ? a.i - b.i : a.w === null ? 1 : -1
      return b.w - a.w || a.i - b.i
    })
    .map((x) => x.abbr)
  if (sorted.every((abbr, i) => abbr === list[i])) return grid
  return { ...grid, order: { ...grid.order, [conf]: sorted } }
}

/** How many teams of a conference already have a wins value. */
/** Wins filled so far in one conference (East vs West total in the sticky bar). */
export function winsInConf(grid: GridPrediction, conf: Conf): number {
  return grid.order[conf].reduce((sum, abbr) => sum + (grid.wins[abbr] ?? 0), 0)
}

export function filledInConf(grid: GridPrediction, conf: Conf): number {
  return grid.order[conf].filter((abbr) => grid.wins[abbr] !== null && grid.wins[abbr] !== undefined).length
}

/** Same members whatever the order (hot-take lists: what the editor shows vs what the server holds). */
export function sameMembers<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  const inB = new Set(b)
  return new Set(a).size === inB.size && a.every((x) => inB.has(x))
}

// Hand-rolled rather than Intl.NumberFormat: the server and every browser must print exactly the
// same characters (thousands separator varies between ICU versions → hydration mismatch).

/** 1230 → "1 230" (narrow no-break space, the French thousands separator). */
export function formatInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** 51.6 → "51,6". */
export function formatLine(n: number): string {
  return n.toFixed(1).replace('.', ',')
}

export type Tone = 'ok' | 'warn' | 'err' | 'neutral'

/** Label next to the live total: "+14 de trop", "il en manque 6", "✓ 1 230". */
export function totalLabel(filled: number, delta: number, teamCount = 30): { text: string; tone: Tone } {
  if (delta > 0) return { text: `+${formatInt(delta)} de trop`, tone: 'err' }
  if (delta < 0) return { text: `il en manque ${formatInt(-delta)}`, tone: filled === teamCount ? 'err' : 'neutral' }
  return filled === teamCount
    ? { text: `✓ ${formatInt(SEASON.totalWins)}`, tone: 'ok' }
    : { text: 'déjà le total, mais il reste des équipes', tone: 'warn' }
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })

/**
 * Save timestamp in Paris time. Fixed time zone so the server render and the browser agree
 * (no hydration mismatch). `withDay` for saves from an earlier visit.
 */
export function formatSavedAt(iso: string, withDay: boolean): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return withDay ? `le ${dayFmt.format(d)} à ${timeFmt.format(d)}` : timeFmt.format(d)
}
