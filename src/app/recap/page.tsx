import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatLockDate } from '@/components/Countdown'
import { InviteButton } from '@/components/InviteButton'
import { QUESTION_BY_ID, QUESTIONS } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt, SEASON } from '@/config/season'
import { getCurrentUser } from '@/lib/auth'
import { answerLabel, answerLookup, PLAYER_BY_ID, TEAM_BY_ABBR } from '@/lib/data'
import { getQuestionOdds } from '@/lib/odds'
import { getOwnPrediction } from '@/lib/predictions'
import type { Conf, QuestionId } from '@/lib/types'
import { answersErrors, CONFS, gridStatus, hotTakesErrors } from '@/lib/validation'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Récap' }

type Status = 'ok' | 'todo' | 'err' | 'optional'

const STATUS_UI: Record<Status, { icon: string; label: string }> = {
  ok: { icon: '✓', label: 'Validé' },
  todo: { icon: '…', label: 'À compléter' },
  err: { icon: '!', label: 'À corriger' },
  optional: { icon: '🔥', label: 'Optionnel' },
}
const CONF_LABEL: Record<Conf, string> = { E: 'Est', W: 'Ouest' }
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

export default async function RecapPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/connexion?mode=connexion')
  // After the lock the read-only public page replaces the checklist.
  if (isLocked()) redirect(`/joueur/${encodeURIComponent(user.pseudo)}`)

  const [pred, { odds }] = await Promise.all([getOwnPrediction(user.id), getQuestionOdds()])
  const { grid, answers, hotTakes } = pred
  const lockDate = formatLockDate(lockAt().toISOString())

  // ---- grid
  const gs = gridStatus(grid)
  const gridState: Status = gs.valid ? 'ok' : gs.filled === 0 ? 'todo' : 'err'
  const extremes = Object.keys(gs.warnings).length
  const flagged = new Set([...gs.orderViolations, ...gs.outOfRange])

  // ---- questions
  const answered = QUESTIONS.filter((q) => answers[q.id]).length
  const missing = QUESTIONS.length - answered
  const aErrors = Object.entries(answersErrors(answers, answerLookup)) as [QuestionId, string][]
  const questionsState: Status = aErrors.length ? 'err' : missing ? 'todo' : 'ok'
  // Non-blocking (spec §4): a Finals MVP from another team than the champion is allowed but odd.
  const fmvpTeam = answers.fmvp ? PLAYER_BY_ID[answers.fmvp]?.team : undefined
  const fmvpOutsideChampion = !!fmvpTeam && !!answers.champion && fmvpTeam !== answers.champion

  // ---- hot takes (optional; the server already drops those that no longer qualify on save)
  const htWarnings = hotTakesErrors(hotTakes, grid, answers, odds)
  const htTeams = new Set(hotTakes.teams)
  const htQuestions = new Set(hotTakes.questions)

  const allGood = gs.valid && questionsState === 'ok'

  return (
    <div className={styles.page}>
      <header>
        <h1>Ton récap</h1>
        <p className={`muted ${styles.lead}`}>
          Modifiable jusqu’au <strong>{lockDate}</strong>.
          {pred.lastSavedAt && <> Dernière sauvegarde : {formatLockDate(pred.lastSavedAt)}.</>}
        </p>
      </header>

      <p className={`notice ${allGood ? 'notice-ok' : 'notice-warn'}`}>
        {allGood
          ? `Tout est bon ! Ta grille est valide et tes ${QUESTIONS.length} réponses sont enregistrées. Tu peux encore tout changer jusqu’au premier match.`
          : `Il reste des choses à régler avant le ${lockDate}.`}
      </p>

      {/* ---------------------------------------------------------------- checklist */}
      <section aria-labelledby="recap-check">
        <h2 id="recap-check" className="visually-hidden">
          Vérifications
        </h2>
        <ol className={styles.checklist}>
          <CheckItem status={gridState} title="Grille">
            {gs.valid ? (
              <p>
                30 équipes classées, {SEASON.totalWins.toLocaleString('fr-FR')} victoires pile. Nickel.
                {extremes > 0 && (
                  <span className="muted">
                    {' '}
                    ({plural(extremes, 'valeur')} extrême{extremes > 1 ? 's' : ''} : vérifie que c’est voulu.)
                  </span>
                )}
              </p>
            ) : gs.filled === 0 ? (
              <p>Pas encore commencée : classe les 30 équipes et donne leurs victoires.</p>
            ) : (
              <ul className={styles.errors}>
                {gs.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {!gs.valid && (
              <p className="muted small">
                Une grille encore incomplète au premier match ne rapporte aucun point (tes réponses aux questions
                comptent quand même).
              </p>
            )}
            <Link href="/grille" className={styles.fix}>
              {gs.valid ? 'Modifier ma grille' : gs.filled === 0 ? 'Commencer ma grille' : 'Compléter ma grille'} →
            </Link>
          </CheckItem>

          <CheckItem
            status={questionsState}
            title="Questions"
            meta={`${answered}/${QUESTIONS.length}`}
          >
            {aErrors.length > 0 && (
              <ul className={styles.errors}>
                {aErrors.map(([id, msg]) => (
                  <li key={id}>
                    <strong>{QUESTION_BY_ID[id].short}</strong> : {msg}
                  </li>
                ))}
              </ul>
            )}
            {missing > 0 ? (
              <p>
                Il te reste {plural(missing, 'question')} : sans réponse, pas de points.
              </p>
            ) : (
              !aErrors.length && <p>Les {QUESTIONS.length} réponses sont là, champion compris.</p>
            )}
            {fmvpOutsideChampion && (
              <p className="small muted">
                <span aria-hidden="true">⚠️ </span>
                {`${QUESTION_BY_ID.fmvp.short} : ${answerLabel('player', answers.fmvp)} ne joue pas pour ton champion (${answerLabel('champion', answers.champion)}). C’est permis, mais c’est rare.`}
              </p>
            )}
            <Link href="/questions" className={styles.fix}>
              {questionsState === 'ok' ? 'Modifier mes réponses' : 'Répondre aux questions'} →
            </Link>
          </CheckItem>

          <CheckItem
            status="optional"
            title="Hot takes"
            meta={`${hotTakes.teams.length}/${SCORING.htMaxTeams} équipes · ${hotTakes.questions.length}/${SCORING.htMaxQuestions} questions`}
          >
            {hotTakes.teams.length + hotTakes.questions.length === 0 ? (
              <p>Aucun pour l’instant. C’est optionnel : garde-les pour tes vraies convictions.</p>
            ) : (
              <ul className={styles.htList}>
                {hotTakes.teams.map((abbr) => (
                  <li key={abbr}>
                    <span className="badge badge-fire">🔥</span> {TEAM_BY_ABBR[abbr]?.shortName ?? abbr} à{' '}
                    {grid.wins[abbr] ?? '?'} V
                  </li>
                ))}
                {hotTakes.questions.map((q) => (
                  <li key={q}>
                    <span className="badge badge-fire">🔥</span> {QUESTION_BY_ID[q].short} :{' '}
                    {answerLabel(QUESTION_BY_ID[q].kind, answers[q])}
                  </li>
                ))}
              </ul>
            )}
            {htWarnings.length > 0 && (
              <div className={`notice notice-warn ${styles.htWarn}`}>
                <p>À revoir avant le verrouillage :</p>
                <ul>
                  {htWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="small muted">
              Ils se cochent sur <Link href="/grille">ta grille</Link> (équipes) et dans{' '}
              <Link href="/questions">les questions</Link>.
            </p>
          </CheckItem>
        </ol>
      </section>

      {/* ---------------------------------------------------------------- summary */}
      <section aria-labelledby="recap-grid">
        <h2 id="recap-grid">Ta grille</h2>
        <div className={styles.confs}>
          {CONFS.map((conf) => (
            <div key={conf} className={`card ${styles.confCard}`}>
              <table className={`table ${styles.table}`}>
                <caption className={`${styles.caption} ${conf === 'E' ? styles.east : styles.west}`}>
                  Conférence {CONF_LABEL[conf]}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      #
                    </th>
                    <th scope="col">Équipe</th>
                    <th scope="col" className="num">
                      V–D
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grid.order[conf].map((abbr, i) => {
                    const team = TEAM_BY_ABBR[abbr]
                    const w = grid.wins[abbr]
                    const rowCls = i === 5 ? styles.cutPlayoffs : i === 9 ? styles.cutPlayIn : undefined
                    return (
                      <tr key={abbr} className={rowCls}>
                        <td className={`num ${styles.rank}`}>{i + 1}</td>
                        <td>
                          <span className={styles.team}>
                            {team && <img src={team.logo} alt="" className="team-logo" width={24} height={24} loading="lazy" />}
                            <span className={styles.teamName}>{team?.shortName ?? abbr}</span>
                            {htTeams.has(abbr) && (
                              <span className="badge badge-fire" title="Hot take">
                                🔥<span className="visually-hidden"> hot take</span>
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`num ${flagged.has(abbr) ? styles.bad : ''}`}>
                          {w === null || w === undefined ? (
                            <span className="muted">
                              <span aria-hidden="true">—</span>
                              <span className="visually-hidden">non renseigné</span>
                            </span>
                          ) : (
                            <>
                              {w}–{SEASON.gamesPerTeam - w}
                              {flagged.has(abbr) && <span className="visually-hidden"> (incohérent)</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="small muted">Traits : fin du top 6 (playoffs directs) et du top 10 (play-in).</p>
      </section>

      <section aria-labelledby="recap-answers">
        <h2 id="recap-answers">Tes réponses</h2>
        <dl className={`card ${styles.answers}`}>
          {QUESTIONS.map((q) => (
            <div key={q.id} className={styles.answer}>
              <dt>
                {q.label} <span className="muted small">· {q.points} pts</span>
              </dt>
              <dd className={answers[q.id] ? undefined : 'muted'}>
                {answers[q.id] ? answerLabel(q.kind, answers[q.id]) : 'Pas encore répondu'}
                {htQuestions.has(q.id) && (
                  <span className="badge badge-fire">
                    🔥<span className="visually-hidden"> hot take</span>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="recap-invite" className={`card ${styles.invite}`}>
        <h2 id="recap-invite">Invite tes potes</h2>
        <p className="muted">
          Plus on est nombreux, plus le classement est drôle. Seul le lien du site est partagé : tes
          pronos restent secrets jusqu’au premier match.
        </p>
        <InviteButton />
      </section>
    </div>
  )
}

function CheckItem({
  status,
  title,
  meta,
  children,
}: {
  status: Status
  title: string
  meta?: string
  children: ReactNode
}) {
  const ui = STATUS_UI[status]
  return (
    <li className={`card ${styles.item}`} data-status={status}>
      <span className={styles.icon} aria-hidden="true">
        {ui.icon}
      </span>
      <div className={styles.itemBody}>
        <h3 className={styles.itemTitle}>
          {title}
          <span className="visually-hidden"> : {ui.label}</span>
          {meta && <span className={`badge ${styles.meta}`}>{meta}</span>}
        </h3>
        {children}
      </div>
    </li>
  )
}
