import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { Countdown, formatLockDate } from '@/components/Countdown'
import { QUESTIONS, QUESTIONS_MAX_POINTS } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt, SEASON } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import { hasValidGrid } from '@/lib/predictions'
import styles from './page.module.css'

// Derived from the barème so the home page can never contradict the rules page.
const GRID_MAX = 30 * (SCORING.winBase + SCORING.rankExact)
const HOT_TAKES_MAX = SCORING.htMaxTeams + SCORING.htMaxQuestions
const fmt = (n: number) => n.toLocaleString('fr-FR')

const STEPS = [
  {
    title: 'Ta grille',
    text: 'Classe les 30 équipes et donne leurs victoires.',
    pts: `${fmt(GRID_MAX)} pts`,
  },
  {
    title: `${QUESTIONS.length} questions`,
    text: 'MVP, ROY, champion… à toi de trancher.',
    pts: `${fmt(QUESTIONS_MAX_POINTS)} pts`,
  },
  {
    title: `Jusqu’à ${HOT_TAKES_MAX} hot takes 🔥`,
    text: `${SCORING.htMaxTeams} équipes et ${SCORING.htMaxQuestions} questions où tu vas à contre-courant de tout le monde.`,
    pts: 'Bonus',
  },
]

export default async function Home() {
  const locked = isLocked()
  const lockIso = lockAt().toISOString()
  const lockDate = formatLockDate(lockIso)
  // The home page must render even if the database is asleep or misconfigured.
  const user = await getCurrentUser().catch((err: unknown) => {
    unstable_rethrow(err)
    return null
  })

  // Step 2 (questions) and the recap open once the grid is complete.
  const gridDone = user && !locked ? await hasValidGrid(user.id).catch(() => false) : false

  const ctas: { href: string; label: string }[] = locked
    ? [
        { href: '/classement', label: 'Voir le classement' },
        user
          ? { href: `/joueur/${encodeURIComponent(user.pseudo)}`, label: 'Mes pronos' }
          : { href: '/connexion?mode=connexion', label: 'Me connecter' },
      ]
    : user
      ? gridDone
        ? [
            { href: '/questions', label: 'Mes questions' },
            { href: '/recap', label: 'Récap' },
          ]
        : [{ href: '/grille', label: 'Continuer ma grille' }]
      : [
          { href: '/connexion?mode=inscription', label: 'Créer mon compte' },
          { href: '/connexion?mode=connexion', label: 'J’ai déjà un compte' },
        ]

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="home-title">
        <p className={styles.kicker}>
          <span aria-hidden="true">🏀</span> Le jeu de pronos entre potes
        </p>
        <h1 id="home-title" className={styles.title}>
          Pronos NBA <span className={styles.season}>{SEASON.label}</span>
        </h1>
        <p className={styles.pitch}>
          Prédis toute la saison avant le premier match, puis chambre tes potes jusqu’en juin.
        </p>

        <div className={styles.clock}>
          {!locked && <p className={styles.clockLabel}>Verrouillage dans</p>}
          <Countdown lockAt={lockIso} size="lg" />
          <p className={styles.lockLine}>
            {locked ? (
              <>
                Les pronos sont verrouillés depuis le premier match, le {lockDate}. Place au classement !
              </>
            ) : (
              <>
                Tout se verrouille au premier match : <strong>{lockDate}</strong>.
              </>
            )}
          </p>
        </div>

        {user && !locked && (
          <p className={styles.hello}>
            Salut {user.pseudo}, {gridDone ? 'ta grille est prête : place aux questions !' : 'ta grille t’attend !'}
          </p>
        )}
        {locked && !user && <p className={styles.hello}>Les inscriptions sont fermées pour cette saison.</p>}

        <div className={styles.ctas}>
          {ctas.map((c, i) => (
            <Link key={c.href} href={c.href} className={`btn ${i === 0 ? 'btn-primary' : ''} ${styles.cta}`}>
              {c.label}
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="home-steps">
        <h2 id="home-steps" className={styles.stepsTitle}>
          {locked ? 'Le jeu' : 'En 3 étapes'}
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={`card ${styles.step}`}>
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              <div className={styles.stepBody}>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepText}>{s.text}</p>
              </div>
              <span className={`badge ${i === 2 ? 'badge-fire' : ''} ${styles.stepPts}`}>{s.pts}</span>
            </li>
          ))}
        </ol>
        <p className={styles.footnote}>
          Pas d’argent, juste la gloire (et le droit de chambrer).{' '}
          <Link href="/regles" className={styles.rulesLink}>
            Le barème expliqué →
          </Link>
        </p>
      </section>
    </div>
  )
}
