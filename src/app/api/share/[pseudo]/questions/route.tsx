// "Partager mes réponses": the 13 answers in a 1080×1920 portrait PNG (a full phone screen).
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { QUESTIONS } from '@/config/questions'
import { answerLabel } from '@/lib/data'
import { C, loadShareTarget, SHARE_H, SHARE_W, shareHeaders, ShareFrame } from '@/lib/share-image'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ pseudo: string }> }) {
  const target = await loadShareTarget((await params).pseudo)
  if ('error' in target) return target.error
  const { pred, locked } = target
  const hot = new Set<string>(pred.hotTakes.questions)

  return new ImageResponse(
    <ShareFrame kicker="MES RÉPONSES" pred={pred} locked={locked} host={req.nextUrl.host}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {QUESTIONS.map((q) => {
          const id = pred.answers[q.id]
          const champion = q.id === 'champion'
          return (
            <div
              key={q.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                minHeight: 92,
                padding: '10px 24px',
                borderRadius: 14,
                backgroundColor: C.box,
                border: `2px solid ${champion ? C.accent : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', fontSize: 21, letterSpacing: 2, color: champion ? C.accent : C.muted }}>
                  {(champion ? `${q.short} 🏆` : q.short).toUpperCase()}
                </div>
                <div style={{ display: 'flex', fontSize: 36, color: id ? C.ink : C.muted, marginTop: 2 }}>
                  {id ? answerLabel(q.kind, id) : 'Pas de réponse'}
                </div>
              </div>
              {hot.has(q.id) ? <div style={{ display: 'flex', fontSize: 40, marginLeft: 12 }}>🔥</div> : null}
            </div>
          )
        })}
      </div>
    </ShareFrame>,
    { width: SHARE_W, height: SHARE_H, headers: shareHeaders(locked) },
  )
}
