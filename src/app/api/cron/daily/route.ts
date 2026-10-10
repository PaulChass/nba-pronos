// Daily cron (vercel.json, 12:00 UTC). Until the lock: refreshes the bookmaker odds snapshot used
// by question hot takes (frozen afterwards: never touched after the lock). Always: refreshes the
// last good standings in kv and the question results ESPN has settled. Each step reports its own
// error; the route never throws.
import { timingSafeEqual } from 'node:crypto'
import { isLocked, SEASON } from '@/config/season'
import { ESPN_UA, refreshAutoResults, refreshStandings } from '@/lib/espn'
import { refreshOddsSnapshot } from '@/lib/odds'

export const dynamic = 'force-dynamic'

type Step = { ok: boolean; error?: string; [detail: string]: unknown }

/** Vercel sends `Authorization: Bearer <CRON_SECRET>` when the env var is set. */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

async function step(task: () => Promise<Step>): Promise<Step> {
  try {
    return await task()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const startedAt = new Date()
  const locked = isLocked(startedAt)
  const [odds, standings, results] = await Promise.all([
    locked
      ? Promise.resolve<Step>({ ok: true, skipped: 'locked: the odds snapshot is frozen' })
      : step(async () => ({ ok: true, markets: await refreshOddsSnapshot(SEASON.espnSeason, ESPN_UA) })),
    step(async () => ({ ok: true, ...(await refreshStandings()) })),
    step(async () => {
      const r = await refreshAutoResults()
      const failed = Object.keys(r.errors).length > 0
      return { ok: !failed, checked: r.checked, final: r.final, ...(failed ? { errors: r.errors } : {}) }
    }),
  ])

  const steps = { odds, standings, results }
  const ok = Object.values(steps).every((s) => s.ok)
  return Response.json(
    { ok, at: startedAt.toISOString(), ms: Date.now() - startedAt.getTime(), locked, steps },
    { status: ok ? 200 : 500 },
  )
}
