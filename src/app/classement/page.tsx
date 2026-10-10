import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { Countdown, formatLockDate } from '@/components/Countdown'
import { LeaderboardTable } from '@/components/score/LeaderboardTable'
import { parisDateTime } from '@/components/score/format'
import { LEADERBOARD_VIEWS, parseView, type LeaderboardView } from '@/components/score/views'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import { getLeaderboard, type Leaderboard } from '@/lib/leaderboard'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Classement' }
// Rendered per request: it flips at the lock and highlights the signed-in player.
export const dynamic = 'force-dynamic'

const VIEW_HELP: Record<LeaderboardView, string> = {
  general:
    'Général = grille + questions + hot takes. Égalité : la meilleure grille passe devant, puis le prono modifié pour la dernière fois le plus tôt.',
  grille: `Par équipe : ${SCORING.winBase} moins l’écart de victoires, +${SCORING.rankExact} si le rang est exact, +${SCORING.rankNear} à une place près.`,
  questions: 'Les points des questions tombent avec les résultats officiels : NBA Cup en décembre, trophées en avril-mai, Finales en juin.',
  'hot-takes': `+${SCORING.htTeamBonus} par équipe réussie, points doublés pour une question réussie. Un hot take non retenu ou raté ne coûte rien.`,
}

export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isLocked()) return <BeforeLock />

  const view = parseView((await searchParams).vue)
  const user = await getCurrentUser().catch(() => null)
  let board: Leaderboard
  try {
    board = await getLeaderboard()
  } catch (err) {
    unstable_rethrow(err)
    console.error('[classement]', err)
    return (
      <div className="stack">
        <h1>Classement</h1>
        <p className="notice notice-err" role="alert">
          Le classement est momentanément indisponible. Réessaie dans quelques minutes.
        </p>
      </div>
    )
  }
  const { cards, standings, final } = board

  return (
    <div className="stack">
      <h1>Classement</h1>

      <nav className={`tabs ${styles.tabs}`} aria-label="Vues du classement">
        {LEADERBOARD_VIEWS.map((v) => (
          <Link
            key={v.id}
            href={v.id === 'general' ? '/classement' : `/classement?vue=${v.id}`}
            className={`tab ${styles.tab}`}
            aria-current={v.id === view ? 'page' : undefined}
            scroll={false}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      <p className="small muted">{VIEW_HELP[view]}</p>

      {cards.length === 0 ? (
        <p className="notice notice-warn">Personne n’avait enregistré de pronos au verrouillage.</p>
      ) : (
        <div className={`card ${styles.tableCard}`}>
          <LeaderboardTable cards={cards} view={view} meId={user?.id ?? null} />
        </div>
      )}

      <p className="small muted">
        {final ? (
          <>
            Classement définitif pour la grille : la saison régulière est terminée (source ESPN). Les questions encore en
            attente tombent avec les résultats officiels.
          </>
        ) : (
          <>
            Classement provisoire : projection mise à jour le {parisDateTime(standings.fetchedAt)} (source ESPN).
            {standings.source === 'cache' && ' ESPN ne répond pas en ce moment : c’est la dernière version connue.'}
          </>
        )}{' '}
        <Link href="/regles">Comment sont calculés les points ?</Link>
      </p>
    </div>
  )
}

function BeforeLock() {
  const lockIso = lockAt().toISOString()
  return (
    <div className="stack">
      <h1>Classement</h1>
      <section className={`card ${styles.closed}`} aria-labelledby="closed-title">
        <h2 id="closed-title" className={styles.closedTitle}>
          Le classement s’ouvre au premier match
        </h2>
        <p className="muted">
          Les points commencent au coup d’envoi, {formatLockDate(lockIso)}, puis le classement se met à jour tout au long
          de la saison. En attendant, les pronos des autres sont dans ton récap.
        </p>
        <Countdown lockAt={lockIso} />
        <Link href="/grille" className="btn btn-primary">
          Remplir ma grille
        </Link>
      </section>
    </div>
  )
}
