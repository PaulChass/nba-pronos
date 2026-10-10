import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { GridEditor } from '@/components/grid/GridEditor'
import { formatInt, type GridTeam } from '@/components/grid/grid-utils'
import { BOOKMAKER_SOURCE, NORMALIZED_LINES } from '@/config/bookmaker-lines'
import { isLocked, lockAt, SEASON } from '@/config/season'
import { TEAMS } from '@/data/teams'
import { getCurrentUser } from '@/lib/auth'
import { getOwnPrediction } from '@/lib/predictions'
import { emptyGrid, parseGrid } from '@/lib/validation'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Ma grille' }

const TEAM_INFO: Record<string, GridTeam> = Object.fromEntries(
  TEAMS.map((t) => [t.abbr, { abbr: t.abbr, name: t.name, shortName: t.shortName, logo: t.logo, conference: t.conference }]),
)

const DEADLINE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
})

/** "mardi 20 octobre à 21h00", Paris time whatever the server's time zone. */
function formatDeadline(date: Date): string {
  const p = Object.fromEntries(DEADLINE_FORMAT.formatToParts(date).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.day === '1' ? '1er' : p.day} ${p.month} à ${p.hour}h${p.minute}`
}

export default async function GrillePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/connexion')
  // After the first tip-off the grid is frozen and public: show it on the player's page.
  if (isLocked()) redirect(`/joueur/${encodeURIComponent(user.pseudo)}`)

  const own = await getOwnPrediction(user.id)
  const lock = lockAt()

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1>Ma grille</h1>
        <p className={styles.intro}>
          Range les 15 équipes de chaque conférence dans l’ordre que tu prévois, puis donne à chacune son nombre de
          victoires. Le total doit faire exactement <strong>{formatInt(SEASON.totalWins)}</strong> ({TEAMS.length} équipes ×{' '}
          {SEASON.gamesPerTeam} matchs ÷ 2).
        </p>
        <p className="small muted">
          Modifiable jusqu’au {formatDeadline(lock)} (heure de Paris). Tout s’enregistre automatiquement.
        </p>
      </header>

      <GridEditor
        // Defensive: a stored grid with an unexpected shape restarts from an empty grid.
        initialGrid={parseGrid(own.grid) ?? emptyGrid()}
        initialHotTeams={own.hotTakes.teams}
        initialHotQuestions={own.hotTakes.questions}
        // Sent back with every save: a save made elsewhere since this render is refused, not overwritten.
        initialVersion={own.versions.grid}
        lastSavedAt={own.lastSavedAt}
        lockAt={lock.toISOString()}
        lines={NORMALIZED_LINES}
        linesSource={BOOKMAKER_SOURCE}
        teams={TEAM_INFO}
      />
    </div>
  )
}
