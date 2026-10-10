// "Partager ma grille": the 30 teams in a 1080×1920 portrait PNG (a full phone screen).
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { SEASON } from '@/config/season'
import { TEAM_BY_ABBR } from '@/lib/data'
import { barColor, C, loadShareTarget, SHARE_H, SHARE_W, shareHeaders, ShareFrame } from '@/lib/share-image'
import type { Conf, StoredPrediction } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ pseudo: string }> }) {
  const target = await loadShareTarget((await params).pseudo)
  if ('error' in target) return target.error
  const { pred, locked } = target

  return new ImageResponse(
    <ShareFrame kicker="MA GRILLE" pred={pred} locked={locked} host={req.nextUrl.host}>
      <div style={{ display: 'flex', gap: 24 }}>
        <ConfColumn pred={pred} conf="E" />
        <ConfColumn pred={pred} conf="W" />
      </div>
      {pred.hotTakes.teams.length > 0 ? (
        <div style={{ display: 'flex', fontSize: 26, color: C.muted }}>🔥 = hot take (contre l’avis de Vegas)</div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </ShareFrame>,
    { width: SHARE_W, height: SHARE_H, headers: shareHeaders(locked) },
  )
}

function ConfColumn({ pred, conf }: { pred: StoredPrediction; conf: Conf }) {
  const hot = new Set(pred.hotTakes.teams)
  const order = pred.grid.order[conf] ?? []
  const total = order.reduce((sum, abbr) => sum + (pred.grid.wins[abbr] ?? 0), 0)
  const color = conf === 'E' ? C.east : C.west
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 8px', marginBottom: 6 }}>
        <div style={{ display: 'flex', fontSize: 32, letterSpacing: 5, color }}>{conf === 'E' ? 'EST' : 'OUEST'}</div>
        <div style={{ display: 'flex', fontSize: 24, color: C.muted }}>{`${total} V`}</div>
      </div>
      {order.map((abbr, i) => {
        const w = pred.grid.wins[abbr]
        return (
          <div
            key={abbr}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 80,
              padding: '0 16px 0 8px',
              borderRadius: 10,
              backgroundColor: i % 2 === 0 ? C.row : 'transparent',
              // Playoff line: a thin separator under the 6th and the 10th (play-in).
              borderBottom: i === 5 || i === 9 ? `2px solid ${C.box}` : '2px solid transparent',
            }}
          >
            <div style={{ display: 'flex', width: 40, justifyContent: 'flex-end', marginRight: 14, fontSize: 26, color: C.muted }}>
              {`${i + 1}`}
            </div>
            <div style={{ display: 'flex', width: 8, height: 34, borderRadius: 4, marginRight: 14, backgroundColor: barColor(TEAM_BY_ABBR[abbr]) }} />
            <div style={{ display: 'flex', fontSize: 38 }}>{abbr}</div>
            {hot.has(abbr) ? <div style={{ display: 'flex', fontSize: 28, marginLeft: 8 }}>🔥</div> : null}
            <div style={{ display: 'flex', flex: 1 }} />
            <div style={{ display: 'flex', fontSize: 40 }}>{w === null || w === undefined ? '—' : `${w}`}</div>
            <div style={{ display: 'flex', fontSize: 24, color: C.muted, marginLeft: 2, marginTop: 8 }}>
              {w === null || w === undefined ? '' : `–${SEASON.gamesPerTeam - w}`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
