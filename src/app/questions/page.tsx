import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { QuestionsForm } from '@/components/questions/QuestionsForm'
import { QUESTIONS, QUESTIONS_MAX_POINTS } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import { coachOptions, playerOptions, teamOptions } from '@/lib/data'
import { getQuestionOdds } from '@/lib/odds'
import { getOwnPrediction } from '@/lib/predictions'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Questions' }

const PARIS = 'Europe/Paris'

/** "mardi 20 octobre à 21h00" (formatted here so server and browser agree). */
function lockLabel(d: Date): string {
  const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: PARIS }).format(d)
  const parts = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: PARIS }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${day} à ${get('hour')}h${get('minute')}`
}

export default async function QuestionsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/connexion')
  const ownPage = `/joueur/${encodeURIComponent(user.pseudo)}`
  if (isLocked()) redirect(ownPage)

  const [prediction, { odds, asOf }] = await Promise.all([getOwnPrediction(user.id), getQuestionOdds()])
  // Step 2 opens once the grid (step 1) is complete.
  if (!prediction.gridValid) redirect('/grille')
  const lock = lockAt()

  return (
    <div className="stack">
      <header className={styles.header}>
        <h1>Les questions</h1>
        <p className={styles.lead}>
          {QUESTIONS.length} questions, {QUESTIONS_MAX_POINTS} points en jeu. Chaque choix s’enregistre tout seul et
          tu peux changer d’avis jusqu’au verrouillage, <strong>{lockLabel(lock)}</strong>.
        </p>
        <p className="small muted">
          🔥 <strong>Hot takes :</strong> désigne jusqu’à {SCORING.htMaxQuestions} questions où tu vas à
          contre-courant. S’il tombe, tes points sont doublés ; raté, il ne te retire rien (mais un choix improbable
          tombe rarement). Quand il y a une cote, le 🔥 ne s’allume que pour un choix au moins {SCORING.htOddsRatio}{' '}
          fois moins probable que le favori des bookmakers. L’avis du groupe sera vérifié au verrouillage.
        </p>
      </header>

      <QuestionsForm
        questions={QUESTIONS}
        initialAnswers={prediction.answers}
        initialHotQuestions={prediction.hotTakes.questions}
        initialVersion={prediction.versions.questions}
        odds={odds}
        oddsAsOf={new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: PARIS }).format(new Date(asOf))}
        options={{
          player: playerOptions(),
          rookie: playerOptions(true),
          coach: coachOptions(),
          team: teamOptions(),
          teamE: teamOptions('E'),
          teamW: teamOptions('W'),
        }}
        lockAt={lock.toISOString()}
        ownPage={ownPage}
        pseudo={user.pseudo}
        lastSavedAt={prediction.lastSavedAt}
      />
    </div>
  )
}
