// Mini-admin (Paul only): players + PIN reset, question results overrides, data health.
// Everything degrades section by section: ESPN or the DB being down never blanks the page.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { QUESTIONS, type QuestionDef } from '@/config/questions'
import { isLocked, lockAt } from '@/config/season'
import { formatLockDate } from '@/components/Countdown'
import styles from '@/components/admin/admin.module.css'
import { parisDay, parisDayTime, parisFull, plural } from '@/components/admin/format'
import { RefreshButton } from '@/components/admin/RefreshButton'
import { ResetPinForm } from '@/components/admin/ResetPinForm'
import { ResultForm, type ResultFormProps } from '@/components/admin/ResultForm'
import { getCurrentUser } from '@/lib/auth'
import { answerLabel, COACHES, DATA_GENERATED_AT, PLAYERS, teamOptions } from '@/lib/data'
import { sql } from '@/lib/db'
import { getAutoResults, getStandings } from '@/lib/espn'
import { getQuestionOdds } from '@/lib/odds'
import { getAdminOverrides, getResults } from '@/lib/results'
import type { AnswerKind, QuestionResult } from '@/lib/types'

export const metadata: Metadata = { title: 'Admin' }

interface PlayerRow {
  id: number
  pseudo: string
  createdAt: string
  lockedUntil: string | null
  gridValid: boolean
  answered: number
  hotTakes: number
  lastSavedAt: string | null
}

async function loadPlayers(): Promise<PlayerRow[]> {
  // Explicit columns: the PIN hash never leaves the database.
  const rows = await sql()`
    select u.id, u.pseudo, u.created_at, u.locked_until,
           p.grid_valid, p.answers, p.hot_takes, p.last_saved_at
    from users u left join predictions p on p.user_id = u.id
    order by u.created_at`
  const now = Date.now()
  return rows.map((r) => {
    const answers = (r.answers ?? {}) as Record<string, unknown>
    const ht = (r.hot_takes ?? {}) as { teams?: unknown[]; questions?: unknown[] }
    const lockedUntil = r.locked_until ? new Date(r.locked_until) : null
    return {
      id: Number(r.id),
      pseudo: String(r.pseudo),
      createdAt: new Date(r.created_at).toISOString(),
      lockedUntil: lockedUntil && lockedUntil.getTime() > now ? lockedUntil.toISOString() : null,
      gridValid: r.grid_valid === true,
      answered: QUESTIONS.filter((q) => typeof answers[q.id] === 'string' && answers[q.id] !== '').length,
      hotTakes: (Array.isArray(ht.teams) ? ht.teams.length : 0) + (Array.isArray(ht.questions) ? ht.questions.length : 0),
      lastSavedAt: r.last_saved_at ? new Date(r.last_saved_at).toISOString() : null,
    }
  })
}

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)

const PERSON_LISTS: Partial<Record<AnswerKind, string>> = {
  player: 'admin-players',
  rookie: 'admin-rookies',
  coach: 'admin-coaches',
}

function describe(q: QuestionDef, r: QuestionResult | undefined): string {
  if (!r || r.status === 'pending') return 'En attente'
  if (r.status === 'void') return 'Annulée'
  return r.winners.map((id) => answerLabel(q.kind, id)).join(' + ') || '—'
}

function formProps(q: QuestionDef, override: QuestionResult | undefined): ResultFormProps {
  const winners = override?.status === 'final' ? override.winners : []
  const listId = PERSON_LISTS[q.kind]
  if (listId) {
    return {
      questionId: q.id,
      mode: 'person',
      listId,
      defaults: winners.map((id) => answerLabel(q.kind, id)),
      hasOverride: !!override,
    }
  }
  const conf = q.kind === 'teamE' ? 'E' : q.kind === 'teamW' ? 'W' : undefined
  return {
    questionId: q.id,
    mode: 'team',
    teams: teamOptions(conf).map((t) => ({ id: t.id, label: t.label })),
    defaults: winners,
    hasOverride: !!override,
  }
}

export default async function AdminPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user?.isAdmin) notFound()

  const [playersR, autoR, overridesR, effectiveR, standingsR, oddsR] = await Promise.allSettled([
    loadPlayers(),
    getAutoResults(),
    getAdminOverrides(),
    getResults(),
    getStandings(),
    getQuestionOdds(),
  ])
  const players = settled(playersR)
  const auto = settled(autoR)
  const overrides = settled(overridesR)
  const effective = settled(effectiveR)
  const standings = settled(standingsR)
  const odds = settled(oddsR)

  const lockIso = lockAt().toISOString()
  const locked = isLocked()
  const lockOverride = process.env.LOCK_AT_OVERRIDE
  const validGrids = players?.filter((p) => p.gridValid).length ?? 0
  const rookies = PLAYERS.filter((p) => p.rookie)

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1>Admin</h1>
        <p className="muted">Réservé à toi, {user.pseudo}. Rien ici n’est visible des autres joueurs.</p>
      </header>

      {lockOverride && (
        <p className="notice notice-err" role="alert">
          <strong>LOCK_AT_OVERRIDE est défini</strong> ({lockOverride}) : le verrouillage ne suit pas le premier
          match de la saison. À retirer absolument en production.
        </p>
      )}

      <nav className={styles.jump} aria-label="Sections de l’admin">
        <a href="#joueurs" className="btn btn-sm">
          Joueurs
        </a>
        <a href="#resultats" className="btn btn-sm">
          Résultats
        </a>
        <a href="#donnees" className="btn btn-sm">
          Données
        </a>
      </nav>

      {/* ------------------------------------------------------------ players */}
      <section id="joueurs" className={`card ${styles.section}`} aria-labelledby="joueurs-title">
        <h2 id="joueurs-title">Joueurs</h2>
        {!players ? (
          <p className="notice notice-err">Impossible de lire les joueurs : la base de données ne répond pas.</p>
        ) : players.length === 0 ? (
          <p className="muted">Personne n’est encore inscrit.</p>
        ) : (
          <>
            <p>
              <strong>
                {plural(players.length, 'joueur', 'joueurs')}, {plural(validGrids, 'grille valide', 'grilles valides')}
              </strong>
            </p>
            <div className={styles.tableWrap} role="region" aria-labelledby="joueurs-title" tabIndex={0}>
              <table className={`table ${styles.playersTable}`}>
                <thead>
                  <tr>
                    <th scope="col">Pseudo</th>
                    <th scope="col">Inscrit le</th>
                    <th scope="col">Grille</th>
                    <th scope="col" className="num">
                      Réponses
                    </th>
                    <th scope="col" className="num">
                      <span aria-hidden>🔥</span>
                      <span className="visually-hidden">Hot takes</span>
                    </th>
                    <th scope="col">Dernière modif</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id}>
                      <th scope="row">
                        {p.pseudo}{' '}
                        {p.lockedUntil && (
                          <span className="badge" title={`Bloqué jusqu’à ${parisDayTime(p.lockedUntil)}`}>
                            bloqué
                          </span>
                        )}
                      </th>
                      <td>{parisDay(p.createdAt)}</td>
                      <td>
                        {p.gridValid ? (
                          <span className={styles.yes}>
                            <span aria-hidden>✓</span>
                            <span className="visually-hidden">valide</span>
                          </span>
                        ) : (
                          <span className={styles.no}>
                            <span aria-hidden>✗</span>
                            <span className="visually-hidden">incomplète</span>
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {p.answered}/{QUESTIONS.length}
                      </td>
                      <td className="num">{p.hotTakes}</td>
                      <td>{p.lastSavedAt ? parisDayTime(p.lastSavedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">Heures de Paris. « Dernière modif » sert au départage en cas d’égalité.</p>
            <ResetPinForm users={players.map((p) => ({ id: p.id, pseudo: p.pseudo }))} />
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ results */}
      <section id="resultats" className={`card ${styles.section}`} aria-labelledby="resultats-title">
        <h2 id="resultats-title">Résultats des questions</h2>
        <p className="small muted">
          Les résultats viennent d’ESPN automatiquement. Ta correction passe toujours devant, jusqu’à ce que tu
          reviennes à l’automatique.
        </p>
        <p className="notice notice-warn">
          <strong>Coach de l’année :</strong> ESPN ne le publie pas, c’est toujours à toi de le saisir, vers fin
          avril. <a href="#q-coy">Y aller</a>
        </p>
        {!auto && (
          <p className="notice notice-warn">
            ESPN indisponible : les résultats automatiques sont illisibles pour l’instant. Tes corrections restent
            possibles.
          </p>
        )}
        {!overrides && (
          <p className="notice notice-err">Impossible de lire tes corrections : la base de données ne répond pas.</p>
        )}

        {/* Shared suggestion lists (one copy for all forms). Values are mapped back to ids server-side. */}
        <datalist id="admin-players">
          {PLAYERS.map((p) => (
            <option key={p.id} value={answerLabel('player', p.id)} />
          ))}
        </datalist>
        <datalist id="admin-rookies">
          {rookies.map((p) => (
            <option key={p.id} value={answerLabel('rookie', p.id)} />
          ))}
        </datalist>
        <datalist id="admin-coaches">
          {COACHES.map((c) => (
            <option key={c.id} value={answerLabel('coach', c.id)} />
          ))}
        </datalist>

        <ol className={styles.questions}>
          {QUESTIONS.map((q) => {
            const override = overrides?.[q.id]
            const isCoy = q.id === 'coy'
            return (
              <li
                key={q.id}
                id={`q-${q.id}`}
                className={`${styles.question} ${isCoy ? styles.highlight : ''}`}
              >
                <div className={styles.qHead}>
                  <h3>{q.short}</h3>
                  <span className="badge">{q.points} pts</span>
                  <span className="small muted">résultat : {q.resolvesAt}</span>
                </div>
                <p className="small muted">{q.label}</p>
                {isCoy && (
                  <p className="small">
                    <strong>Toujours manuel.</strong> Saisis le vainqueur dès l’annonce officielle de la NBA.
                  </p>
                )}
                <dl className={styles.values}>
                  <dt>Auto (ESPN)</dt>
                  <dd>{isCoy ? 'Jamais automatique' : auto ? describe(q, auto[q.id]) : 'ESPN indisponible'}</dd>
                  <dt>Ta correction</dt>
                  <dd>{!overrides ? '—' : override ? describe(q, override) : 'Aucune'}</dd>
                  <dt>Retenu</dt>
                  <dd>
                    <strong>{effective ? describe(q, effective[q.id]) : 'Indisponible'}</strong>
                  </dd>
                </dl>
                <ResultForm {...formProps(q, override)} />
              </li>
            )
          })}
        </ol>
      </section>

      {/* ------------------------------------------------------------ data health */}
      <section id="donnees" className={`card ${styles.section}`} aria-labelledby="donnees-title">
        <h2 id="donnees-title">État des données</h2>
        <dl className={styles.values}>
          <dt>Verrouillage</dt>
          <dd>
            <time dateTime={lockIso}>{formatLockDate(lockIso)}</time>{' '}
            <span className="badge">{locked ? 'Verrouillé' : 'Ouvert'}</span>
            {lockOverride && (
              <>
                {' '}
                <span className="badge">forcé par LOCK_AT_OVERRIDE</span>
              </>
            )}
          </dd>

          <dt>Classement NBA</dt>
          <dd>
            {standings ? (
              <>
                {standings.source === 'live' ? 'ESPN en direct' : 'Copie gardée en base (ESPN injoignable)'} · lu le{' '}
                {parisFull(standings.fetchedAt)} · {plural(standings.teams.length, 'équipe', 'équipes')}
              </>
            ) : (
              'ESPN indisponible, et aucune copie en base'
            )}
          </dd>

          <dt>Cotes (hot takes)</dt>
          <dd>
            {odds ? (
              <>
                {odds.source === 'snapshot' ? 'Copie ESPN (DraftKings)' : 'Fichier de secours'} du{' '}
                {parisFull(odds.asOf)} · {plural(Object.keys(odds.odds).length, 'marché', 'marchés')}
                {locked ? ' · figées au verrouillage' : ''}
              </>
            ) : (
              'Illisibles'
            )}
          </dd>

          <dt>Joueurs NBA</dt>
          <dd>
            Liste générée le {parisFull(DATA_GENERATED_AT)} · {plural(PLAYERS.length, 'joueur', 'joueurs')} dont{' '}
            {rookies.length} rookies · {plural(COACHES.length, 'coach', 'coachs')}
          </dd>
        </dl>
        {standings?.source === 'cache' && (
          <p className="notice notice-warn">
            ESPN ne répond pas : le classement utilise la dernière version valide gardée en base.
          </p>
        )}
        <p className="small muted">
          Le classement NBA est gardé en cache 30 minutes. Après une correction ou si ESPN a du retard, force la mise à
          jour des pages Classement, Consensus et joueurs.
        </p>
        <RefreshButton />
      </section>
    </div>
  )
}
