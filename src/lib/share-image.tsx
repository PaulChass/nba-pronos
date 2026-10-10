// Shared bits of the share images (/api/share/[pseudo]/grille and /questions): who may see a
// player's image, cache headers, and the look (Satori: flexbox only, inline styles).
//
// Access follows the predictions themselves: before the lock, signed-in players only (Paul's
// choice: they can see each other's predictions); after the lock, public.
import { isLocked, lockAt, SEASON } from '@/config/season'
import { getCurrentUser, pseudoKey } from './auth'
import { getPredictionByPseudo } from './predictions'
import type { ReactNode } from 'react'
import type { StoredPrediction, Team } from './types'

/** Portrait 9:16: fills a phone screen (WhatsApp status, stories, gallery). */
export const SHARE_W = 1080
export const SHARE_H = 1920

// Image palette = the app's dark theme (an image has no light/dark mode).
export const C = {
  bg: '#0e1014',
  bg2: '#1a1e26',
  ink: '#f1f2f4',
  muted: '#9aa0aa',
  row: 'rgba(255,255,255,0.05)',
  box: 'rgba(255,255,255,0.06)',
  accent: '#ff7a2f',
  east: '#6b9bff',
  west: '#ff8a4c',
}

const noStore = { 'Cache-Control': 'no-store' }

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export type ShareTarget = { pred: StoredPrediction; locked: boolean } | { error: Response }

/** Loads the prediction an image is about, or the error response to send instead. */
export async function loadShareTarget(rawPseudo: string): Promise<ShareTarget> {
  const locked = isLocked()
  try {
    if (!locked && !(await getCurrentUser())) {
      return { error: new Response('Sign in first', { status: 401, headers: noStore }) }
    }
    const pred = await getPredictionByPseudo(pseudoKey(safeDecode(rawPseudo)))
    if (!pred) return { error: new Response('Not found', { status: 404, headers: noStore }) }
    return { pred, locked }
  } catch {
    return { error: new Response('Unavailable', { status: 503, headers: noStore }) }
  }
}

/** Before the lock the prediction can still change (and is not public): never cache it. */
export function shareHeaders(locked: boolean): Record<string, string> {
  return locked
    ? { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' }
    : { 'Cache-Control': 'private, no-store' }
}

/** Relative luminance (WCAG) of a #rrggbb color. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Team color that stays visible on the dark background (Nets/Spurs black → their alt color). */
export function barColor(team: Team | undefined): string {
  if (!team) return C.muted
  if (luminance(team.color) >= 0.04) return team.color
  return luminance(team.altColor) >= 0.04 ? team.altColor : C.muted
}

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })

/** Full-height dark card with the title block on top and the site + date at the bottom. */
export function ShareFrame({
  kicker,
  pred,
  locked,
  host,
  children,
}: {
  kicker: string
  pred: StoredPrediction
  locked: boolean
  host: string
  children: ReactNode
}) {
  const stamp = locked ? `🔒 Verrouillé le ${DAY.format(lockAt())}` : `Version du ${DAY.format(new Date(pred.lastSavedAt))}`
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 56px 56px',
        backgroundColor: C.bg,
        backgroundImage: `linear-gradient(165deg, ${C.bg2} 0%, ${C.bg} 55%)`,
        color: C.ink,
        fontSize: 30,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', color: C.accent, fontSize: 36, letterSpacing: 3 }}>
          {`🏀 ${kicker} NBA ${SEASON.label}`}
        </div>
        <div style={{ display: 'flex', fontSize: 92, lineHeight: 1.1, marginTop: 8 }}>{pred.pseudo}</div>
        <div style={{ display: 'flex', height: 7, width: 140, marginTop: 16, backgroundColor: C.accent, borderRadius: 4 }} />
      </div>

      {children}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: C.muted }}>
        <div style={{ display: 'flex', color: C.ink }}>{host}</div>
        <div style={{ display: 'flex' }}>{stamp}</div>
      </div>
    </div>
  )
}
