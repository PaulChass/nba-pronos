// Share image (1080×1350 PNG, the 4:5 portrait format WhatsApp/Instagram/Facebook show best).
// It exists only after the lock: before, it would leak a player's predictions to the group.
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { QUESTION_BY_ID } from '@/config/questions'
import { isLocked, lockAt, SEASON } from '@/config/season'
import { pseudoKey } from '@/lib/auth'
import { answerLabel, TEAM_BY_ABBR } from '@/lib/data'
import { listPredictionsAfterLock } from '@/lib/predictions'
import type { Conf, QuestionId, StoredPrediction, Team } from '@/lib/types'

export const dynamic = 'force-dynamic'

const W = 1080
const H = 1350

// Image palette = the app's dark theme (an image has no light/dark mode).
const C = {
  bg: '#0e1014',
  bg2: '#1a1e26',
  ink: '#f1f2f4',
  muted: '#9aa0aa',
  row: 'rgba(255,255,255,0.045)',
  box: 'rgba(255,255,255,0.06)',
  accent: '#ff7a2f',
  east: '#6b9bff',
  west: '#ff8a4c',
}

const noStore = { 'Cache-Control': 'no-store' }

function notFound(): Response {
  // no-store: a 404 cached by the CDN just before the lock must not outlive it.
  return new Response('Not found', { status: 404, headers: noStore })
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
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
function barColor(team: Team | undefined): string {
  if (!team) return C.muted
  if (luminance(team.color) >= 0.04) return team.color
  return luminance(team.altColor) >= 0.04 ? team.altColor : C.muted
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pseudo: string }> }) {
  if (!isLocked()) return notFound()

  const { pseudo } = await params
  const key = pseudoKey(safeDecode(pseudo))
  let pred: StoredPrediction | undefined
  try {
    pred = (await listPredictionsAfterLock()).find((p) => pseudoKey(p.pseudo) === key)
  } catch {
    return new Response('Unavailable', { status: 503, headers: noStore })
  }
  if (!pred) return notFound()

  const host = req.nextUrl.host
  const lockDay = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(lockAt())

  return new ImageResponse(<ShareCard pred={pred} host={host} lockDay={lockDay} />, {
    width: W,
    height: H,
    // Predictions never change after the lock: let browsers and the CDN keep the PNG.
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable' },
  })
}

// ---------------------------------------------------------------- image (Satori: flexbox only)

function ShareCard({ pred, host, lockDay }: { pred: StoredPrediction; host: string; lockDay: string }) {
  const hotQ = new Set(pred.hotTakes.questions)
  const answer = (q: QuestionId) => {
    const label = answerLabel(QUESTION_BY_ID[q].kind, pred.answers[q])
    return hotQ.has(q) ? `${label} 🔥` : label
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '52px 60px 40px',
        backgroundColor: C.bg,
        backgroundImage: `linear-gradient(165deg, ${C.bg2} 0%, ${C.bg} 60%)`,
        color: C.ink,
        fontSize: 28,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', color: C.accent, fontSize: 34, letterSpacing: 3 }}>
          {`🏀 MES PRONOS NBA ${SEASON.label}`}
        </div>
        <div style={{ display: 'flex', fontSize: 80, lineHeight: 1.1, marginTop: 6 }}>{pred.pseudo}</div>
        <div style={{ display: 'flex', height: 6, width: 120, marginTop: 14, backgroundColor: C.accent, borderRadius: 3 }} />
      </div>

      {/* Grid: East / West */}
      <div style={{ display: 'flex', gap: 28 }}>
        <ConfColumn pred={pred} conf="E" />
        <ConfColumn pred={pred} conf="W" />
      </div>

      {/* Key answers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <AnswerBox label="MVP" lines={[answer('mvp')]} />
          <AnswerBox label="Rookie de l’année" lines={[answer('roy')]} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <AnswerBox label="Défenseur de l’année" lines={[answer('dpoy')]} />
          <AnswerBox label="NBA Cup" lines={[answer('cup')]} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <AnswerBox label="Champion 🏆" lines={[answer('champion')]} highlight />
          <AnswerBox label="Finalistes" lines={[answer('finalistE'), answer('finalistW')]} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 24, color: C.muted }}>
        <div style={{ display: 'flex', color: C.ink }}>{host}</div>
        <div style={{ display: 'flex' }}>{`🔒 Verrouillé le ${lockDay}`}</div>
      </div>
    </div>
  )
}

function ConfColumn({ pred, conf }: { pred: StoredPrediction; conf: Conf }) {
  const hot = new Set(pred.hotTakes.teams)
  const order = pred.grid.order[conf] ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
      <div
        style={{
          display: 'flex',
          fontSize: 26,
          letterSpacing: 4,
          color: conf === 'E' ? C.east : C.west,
          marginBottom: 6,
          paddingLeft: 4,
        }}
      >
        {conf === 'E' ? 'EST' : 'OUEST'}
      </div>
      {order.map((abbr, i) => {
        const w = pred.grid.wins[abbr]
        return (
          <div
            key={abbr}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 38,
              padding: '0 14px 0 10px',
              borderRadius: 8,
              backgroundColor: i % 2 === 0 ? C.row : 'transparent',
            }}
          >
            <div style={{ display: 'flex', width: 38, justifyContent: 'flex-end', marginRight: 12, fontSize: 22, color: C.muted }}>
              {`${i + 1}`}
            </div>
            <div style={{ display: 'flex', width: 7, height: 24, borderRadius: 3, marginRight: 12, backgroundColor: barColor(TEAM_BY_ABBR[abbr]) }} />
            <div style={{ display: 'flex', fontSize: 27 }}>{abbr}</div>
            {hot.has(abbr) ? <div style={{ display: 'flex', fontSize: 22, marginLeft: 8 }}>🔥</div> : null}
            <div style={{ display: 'flex', flex: 1 }} />
            <div style={{ display: 'flex', fontSize: 27 }}>{w === null || w === undefined ? '—' : `${w}`}</div>
            <div style={{ display: 'flex', fontSize: 18, color: C.muted, marginLeft: 4, marginTop: 6 }}>V</div>
          </div>
        )
      })}
    </div>
  )
}

function AnswerBox({ label, lines, highlight = false }: { label: string; lines: string[]; highlight?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: '12px 18px',
        borderRadius: 14,
        backgroundColor: C.box,
        border: `2px solid ${highlight ? C.accent : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', fontSize: 18, letterSpacing: 2, color: highlight ? C.accent : C.muted }}>
        {label.toUpperCase()}
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', fontSize: 25, marginTop: i === 0 ? 4 : 0 }}>
          {line}
        </div>
      ))}
    </div>
  )
}
