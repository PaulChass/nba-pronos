import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, unstable_rethrow } from 'next/navigation'
import { Countdown, formatLockDate } from '@/components/Countdown'
import { ShareButton } from '@/components/ShareButton'
import { AnswersReadOnly, GridReadOnly } from '@/components/score/PredictionReadOnly'
import { QuestionScoreList } from '@/components/score/QuestionScoreList'
import { ScoreHeader } from '@/components/score/ScoreHeader'
import { TeamScoreList } from '@/components/score/TeamScoreList'
import { IN_DANGER_MAX, ON_TRACK_MIN } from '@/components/score/explain'
import { ordinal, parisDateTime, pts } from '@/components/score/format'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt } from '@/config/season'
import { cleanPseudo, getCurrentUser, pseudoKey, type User } from '@/lib/auth'
import { getLeaderboard, getPlayerCard, type Leaderboard, type PlayerCard } from '@/lib/leaderboard'
import { getOwnPrediction } from '@/lib/predictions'
import type { TeamAbbr, TeamStanding } from '@/lib/types'
import { gridStatus } from '@/lib/validation'
import styles from './page.module.css'

type Props = { params: Promise<{ pseudo: string }> }

// Rendered per request: private before the lock, live scores after.
export const dynamic = 'force-dynamic'

/** Route params may arrive percent-encoded; pseudos never contain "%", so decoding is safe. */
function pseudoFromParam(raw: string): string {
  try {
    return cleanPseudo(decodeURIComponent(raw))
  } catch {
    return cleanPseudo(raw)
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pseudo = pseudoFromParam((await params).pseudo)
  // Before the lock, say nothing that would confirm who has played.
  if (!isLocked()) return { title: 'Mes pronos' }
  try {
    const [player, board] = await Promise.all([getPlayerCard(pseudo), getLeaderboard()])
    if (!player) return { title: 'Joueur introuvable' }
    const { card } = player
    return {
      title: `Pronos de ${card.pseudo}`,
      description: `${card.pseudo} : ${ordinal(card.rank)} sur ${board.cards.length} avec ${pts(card.total)} (grille ${card.grid}, questions ${card.questions}, hot takes ${card.hotTakes}).`,
    }
  } catch (err) {
    unstable_rethrow(err)
    return { title: `Pronos de ${pseudo}` }
  }
}

export default async function PlayerPage({ params }: Props) {
  const pseudo = pseudoFromParam((await params).pseudo)
  const user = await getCurrentUser().catch(() => null)
  const isOwner = !!user && pseudoKey(user.pseudo) === pseudoKey(pseudo)

  if (!isLocked()) {
    // Predictions are private until the first tip-off: only their owner may look.
    if (!user || !isOwner) notFound()
    return <BeforeLock user={user} />
  }

  let data: [PlayerCard | null, Leaderboard]
  try {
    data = await Promise.all([getPlayerCard(pseudo), getLeaderboard()])
  } catch (err) {
    unstable_rethrow(err)
    console.error('[joueur]', err)
    return (
      <div className="stack">
        <h1>{pseudo}</h1>
        <p className="notice notice-err" role="alert">
          Les points sont momentanément indisponibles. Réessaie dans quelques minutes.
        </p>
      </div>
    )
  }
  const [player, board] = data
  if (!player) {
    // The Nav links every signed-in player here, even one who never saved anything.
    if (!isOwner) notFound()
    return (
      <div className="stack">
        <h1>Mes pronos</h1>
        <p className="notice notice-warn">
          Tu n’avais enregistré aucun prono avant le verrouillage : pas de points cette saison. Tu peux quand même suivre
          les autres.
        </p>
        <Link href="/classement" className="btn btn-primary">
          Voir le classement
        </Link>
      </div>
    )
  }

  const { card } = player
  const { final, standings, ctx, results } = board
  const standingByAbbr: Partial<Record<TeamAbbr, TeamStanding>> = Object.fromEntries(
    standings.teams.map((s) => [s.abbr, s]),
  )
  const url = await absoluteUrl(`/joueur/${encodeURIComponent(card.pseudo)}`)
  const whose = (mine: string, theirs: string) => (isOwner ? mine : `${theirs} de ${card.pseudo}`)

  return (
    <div className="stack">
      <ScoreHeader card={card} nPlayers={board.cards.length} isOwner={isOwner}>
        <div className="row">
          <ShareButton pseudo={card.pseudo} url={url} />
          <Link href="/regles" className="btn btn-ghost btn-sm">
            Comment sont calculés mes points ?
          </Link>
        </div>
      </ScoreHeader>

      <p className="small muted">
        {final
          ? 'Grille définitive : la saison régulière est terminée (source ESPN).'
          : `Points provisoires : chaque équipe est comparée à sa projection, mise à jour le ${parisDateTime(standings.fetchedAt)} (source ESPN).`}{' '}
        <Link href="/classement">Voir le classement</Link>
      </p>

      <section className="card" aria-labelledby="grid-title">
        <div className={styles.sectionHead}>
          <h2 id="grid-title">{whose('Ma grille', 'Grille')}</h2>
          <span className={styles.sectionTotal}>{pts(card.grid)}</span>
        </div>
        <p className="small muted">
          Par équipe : {SCORING.winBase} moins l’écart de victoires (minimum 0), +{SCORING.rankExact} si le rang est
          exact, +{SCORING.rankNear} à une place près.
          {!final &&
            ` En bonne voie : ${ON_TRACK_MIN} pts de victoires ou plus. En danger : ${IN_DANGER_MAX} ou moins.`}{' '}
          Ouvre « Le calcul » pour voir les chiffres.
        </p>
        {!card.gridValid ? (
          // The engine lists an invalid grid with 0 everywhere: show what was entered instead.
          <>
            <p className="notice notice-warn">
              Grille incomplète ou invalide au verrouillage : elle ne rapporte aucun point, et ses hot takes équipes ne
              sont pas retenus.
            </p>
            <GridReadOnly grid={player.prediction.grid} hotTakes={player.prediction.hotTakes} />
          </>
        ) : (
          <>
            <TeamScoreList
              conf="E"
              teams={card.teams}
              standings={standingByAbbr}
              medians={ctx.medianOthers[card.userId]}
              final={final}
            />
            <TeamScoreList
              conf="W"
              teams={card.teams}
              standings={standingByAbbr}
              medians={ctx.medianOthers[card.userId]}
              final={final}
            />
          </>
        )}
      </section>

      <section className="card" aria-labelledby="answers-title">
        <div className={styles.sectionHead}>
          <h2 id="answers-title">{whose('Mes réponses', 'Réponses')}</h2>
          <span className={styles.sectionTotal}>{pts(card.questions)}</span>
        </div>
        <p className="small muted">
          Les points tombent avec les résultats officiels. Un hot take 🔥 réussi double les points de la question.
        </p>
        <QuestionScoreList qs={card.qs} results={results} ctx={ctx} />
      </section>
    </div>
  )
}

async function BeforeLock({ user }: { user: User }) {
  const own = await getOwnPrediction(user.id)
  const status = gridStatus(own.grid)
  const lockIso = lockAt().toISOString()
  return (
    <div className="stack">
      <h1>Mes pronos</h1>
      <div className={`card ${styles.private}`}>
        <p>
          Tes pronos restent secrets jusqu’au premier match, {formatLockDate(lockIso)}. Ensuite, tout le monde pourra les
          voir, et tes points s’afficheront ici.
        </p>
        <Countdown lockAt={lockIso} />
        <div className="row">
          <Link href="/grille" className="btn btn-primary btn-sm">
            Modifier ma grille
          </Link>
          <Link href="/questions" className="btn btn-sm">
            Modifier mes réponses
          </Link>
        </div>
      </div>
      {!status.valid && (
        <div className="notice notice-err" role="status">
          <strong>Ta grille n’est pas encore valide.</strong> {status.errors[0]}{' '}
          <Link href="/grille">La compléter</Link>
        </div>
      )}

      <section className="card" aria-labelledby="own-grid-title">
        <h2 id="own-grid-title">Ma grille</h2>
        <GridReadOnly grid={own.grid} hotTakes={own.hotTakes} />
      </section>

      <section className="card" aria-labelledby="own-answers-title">
        <h2 id="own-answers-title">Mes réponses</h2>
        <AnswersReadOnly answers={own.answers} hotTakes={own.hotTakes} />
      </section>
    </div>
  )
}

/** Absolute URL of this deployment (share links need one). */
async function absoluteUrl(path: string): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')
  return `${proto}://${host}${path}`
}
