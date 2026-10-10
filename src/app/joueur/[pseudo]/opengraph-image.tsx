// Link preview of /joueur/[pseudo] (WhatsApp, Facebook, iMessage…). Before the lock it is a
// generic card: the preview must never reveal a player's predictions to the group.
import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { isLocked, SEASON } from '@/config/season'
import { pseudoKey } from '@/lib/auth'
import { answerLabel, TEAM_BY_ABBR } from '@/lib/data'
import { listPredictionsAfterLock } from '@/lib/predictions'
import type { Conf, StoredPrediction, Team } from '@/lib/types'

export const alt = `Les pronos NBA ${SEASON.label}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
// Never prerender: the card switches from generic to personal at the lock.
export const dynamic = 'force-dynamic'

const C = {
  bg: '#0e1014',
  bg2: '#1f1a17',
  ink: '#f1f2f4',
  muted: '#9aa0aa',
  box: 'rgba(255,255,255,0.06)',
  accent: '#ff7a2f',
  east: '#6b9bff',
  west: '#ff8a4c',
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Team color that stays visible on the dark background. */
function barColor(team: Team | undefined): string {
  if (!team) return C.muted
  if (luminance(team.color) >= 0.04) return team.color
  return luminance(team.altColor) >= 0.04 ? team.altColor : C.muted
}

async function findPrediction(raw: string): Promise<StoredPrediction | null> {
  if (!isLocked()) return null
  const key = pseudoKey(safeDecode(raw))
  try {
    return (await listPredictionsAfterLock()).find((p) => pseudoKey(p.pseudo) === key) ?? null
  } catch {
    return null // DB hiccup: fall back to the generic card rather than a broken preview
  }
}

export default async function Image({ params }: { params: Promise<{ pseudo: string }> }) {
  const { pseudo } = await params
  const host = (await headers()).get('host') ?? ''
  const pred = await findPrediction(pseudo)

  return new ImageResponse(pred ? <PlayerCard pred={pred} host={host} /> : <GenericCard host={host} />, {
    ...size,
    headers: {
      // After the lock the personal card never changes; the generic one may become personal.
      'Cache-Control': pred ? 'public, max-age=86400, s-maxage=86400' : 'public, max-age=300, s-maxage=300',
    },
  })
}

// ---------------------------------------------------------------- cards (Satori: flexbox only)

function Frame({ host, children }: { host: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 60px 36px',
        backgroundColor: C.bg,
        backgroundImage: `linear-gradient(150deg, ${C.bg2} 0%, ${C.bg} 65%)`,
        color: C.ink,
        fontSize: 28,
      }}
    >
      {children}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, color: C.muted }}>
        <div style={{ display: 'flex', color: C.ink }}>{host}</div>
        <div style={{ display: 'flex' }}>{`Pronos NBA ${SEASON.label}`}</div>
      </div>
    </div>
  )
}

function GenericCard({ host }: { host: string }) {
  return (
    <Frame host={host}>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40 }}>
        <div style={{ display: 'flex', fontSize: 110 }}>🏀</div>
        <div style={{ display: 'flex', fontSize: 84, lineHeight: 1.05, marginTop: 18, letterSpacing: 1 }}>
          {`PRONOS NBA ${SEASON.label}`}
        </div>
        <div style={{ display: 'flex', height: 6, width: 140, marginTop: 22, backgroundColor: C.accent, borderRadius: 3 }} />
        <div style={{ display: 'flex', fontSize: 34, color: C.muted, marginTop: 26 }}>
          Bilans, trophées et hot takes 🔥 entre potes, classement en direct.
        </div>
      </div>
    </Frame>
  )
}

function PlayerCard({ pred, host }: { pred: StoredPrediction; host: string }) {
  return (
    <Frame host={host}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', color: C.accent, fontSize: 28, letterSpacing: 3 }}>
          {`🏀 LES PRONOS NBA ${SEASON.label} DE`}
        </div>
        <div style={{ display: 'flex', fontSize: 76, lineHeight: 1.1, marginTop: 4 }}>{pred.pseudo}</div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Champion + MVP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 520 }}>
          <Pick label="Champion 🏆" value={answerLabel('champion', pred.answers.champion)} highlight />
          <Pick label="MVP" value={answerLabel('player', pred.answers.mvp)} />
        </div>
        {/* Top 3 of each conference */}
        <TopTeams pred={pred} conf="E" />
        <TopTeams pred={pred} conf="W" />
      </div>
    </Frame>
  )
}

function Pick({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 20px',
        borderRadius: 14,
        backgroundColor: C.box,
        border: `2px solid ${highlight ? C.accent : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', fontSize: 18, letterSpacing: 2, color: highlight ? C.accent : C.muted }}>
        {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', fontSize: 32, marginTop: 4 }}>{value}</div>
    </div>
  )
}

function TopTeams({ pred, conf }: { pred: StoredPrediction; conf: Conf }) {
  const hot = new Set(pred.hotTakes.teams)
  const top = (pred.grid.order[conf] ?? []).slice(0, 3)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: 8,
        padding: '14px 18px',
        borderRadius: 14,
        backgroundColor: C.box,
      }}
    >
      <div style={{ display: 'flex', fontSize: 18, letterSpacing: 3, color: conf === 'E' ? C.east : C.west }}>
        {conf === 'E' ? 'TOP 3 EST' : 'TOP 3 OUEST'}
      </div>
      {top.map((abbr, i) => {
        const w = pred.grid.wins[abbr]
        return (
          <div key={abbr} style={{ display: 'flex', alignItems: 'center', height: 40 }}>
            <div style={{ display: 'flex', width: 26, fontSize: 22, color: C.muted }}>{`${i + 1}`}</div>
            <div style={{ display: 'flex', width: 6, height: 24, borderRadius: 3, marginRight: 10, backgroundColor: barColor(TEAM_BY_ABBR[abbr]) }} />
            <div style={{ display: 'flex', fontSize: 28 }}>{hot.has(abbr) ? `${abbr} 🔥` : abbr}</div>
            <div style={{ display: 'flex', flex: 1 }} />
            <div style={{ display: 'flex', fontSize: 28 }}>{w === null || w === undefined ? '—' : `${w}`}</div>
          </div>
        )
      })}
    </div>
  )
}
