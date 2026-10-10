'use client'

import Link from 'next/link'
import { ShareButton } from '@/components/ShareButton'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { saveAnswersAction, saveHotTakesAction } from '@/app/actions/predictions'
import type { QuestionDef } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import type { PickerOption } from '@/lib/data'
import type { AnswerKind, Answers, QuestionId, QuestionOdds } from '@/lib/types'
import { Combobox } from './Combobox'
import {
  answeredCount,
  applyPick,
  formatPct,
  hotTakeState,
  optionTeam,
  rollbackRefusedHot,
  sameMembers,
  staleHotTakes,
  TEAM,
  topFavorites,
} from './logic'
import { ChampionPicker, TeamPicker } from './TeamPicker'
import styles from './QuestionsForm.module.css'

export type OptionLists = Record<'player' | 'rookie' | 'coach' | 'team' | 'teamE' | 'teamW', PickerOption[]>

export interface QuestionsFormProps {
  questions: readonly QuestionDef[]
  initialAnswers: Answers
  initialHotQuestions: QuestionId[]
  /** Version of the stored prediction this page starts from (0 = never saved): a save from a stale tab is refused. */
  initialVersion: number
  odds: QuestionOdds
  /** "10 oct." — date of the odds snapshot. */
  oddsAsOf: string
  options: OptionLists
  /** ISO instant of the lock. */
  lockAt: string
  /** The user's public page, shown once locked. */
  ownPage: string
  /** The player's pseudo: the share image is fetched by pseudo. */
  pseudo: string
  /** Last save from an earlier visit (ISO), null if never saved: versions the share image. */
  lastSavedAt: string | null
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saved'; at: string | null }
  | { kind: 'error'; message: string }

type Notes = Partial<Record<QuestionId, string>>

const SAVE_DEBOUNCE_MS = 600
const NETWORK_ERROR = 'Connexion perdue : tes derniers choix ne sont pas encore enregistrés.'
const HOT_DROPPED = '🔥 Hot take retiré : ce choix n’est plus assez audacieux.'
const HOT_REFUSED = '🔥 Hot take refusé : selon les dernières cotes des bookmakers, ce choix n’est pas assez audacieux.'
const CONFLICT_NOTICE =
  'Tes pronos ont été modifiés ailleurs (autre onglet ou autre appareil) : tes derniers choix ici ne sont pas enregistrés. Recharge la page pour repartir de la dernière version.'
/** Refusals that rolling back a 🔥 would not fix. */
const SESSION_OR_LOCK = /reconnecte|verrouill/i

function listFor(kind: AnswerKind): keyof OptionLists {
  return kind === 'champion' ? 'team' : kind
}

const withoutKeys = <T extends object>(obj: T, keys: readonly string[]): T => {
  if (!keys.some((k) => k in obj)) return obj
  const next = { ...obj }
  for (const k of keys) delete next[k as keyof T]
  return next
}

/** A save with no answer after this fails (shown as a lost connection, retried) instead of hanging. */
const SAVE_TIMEOUT_MS = 20_000
function withTimeout<T>(p: Promise<T>): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error('timeout')), SAVE_TIMEOUT_MS)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t))
}

export function QuestionsForm({
  questions,
  initialAnswers,
  initialHotQuestions,
  initialVersion,
  odds,
  oddsAsOf,
  options,
  lockAt,
  ownPage,
  pseudo,
  lastSavedAt,
}: QuestionsFormProps) {
  const router = useRouter()
  // A stored 🔥 can stop qualifying after an odds refresh: never show it as declared.
  const [boot] = useState(() => {
    const stale = staleHotTakes(initialHotQuestions, initialAnswers, odds)
    return { hot: initialHotQuestions.filter((h) => !stale.includes(h)), stale }
  })
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [hotQs, setHotQs] = useState<QuestionId[]>(boot.hot)
  const [showFav, setShowFav] = useState(false)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<Notes>({})
  const [notes, setNotes] = useState<Notes>(() => Object.fromEntries(boot.stale.map((h) => [h, HOT_DROPPED])))
  const [locked, setLocked] = useState(false)
  // Another tab or device saved since this page loaded: saving would overwrite it, so stop.
  const [conflict, setConflict] = useState(false)
  const readOnly = locked || conflict

  // Refs hold the latest values for the save loop (state updates are async).
  const answersRef = useRef(answers)
  const hotRef = useRef(hotQs)
  /** The question hot takes the server holds, as far as this tab knows. */
  const hotAccepted = useRef<QuestionId[]>(initialHotQuestions)
  /** Version of the stored prediction this tab is based on; sent with every save. */
  const versionRef = useRef(initialVersion)
  const conflictRef = useRef(false)
  const dirty = useRef({ answers: false, hot: false })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loop = useRef<Promise<boolean> | null>(null)

  // Past the lock the server refuses every save: switch the page to read-only on time.
  useEffect(() => {
    const ms = Date.parse(lockAt) - Date.now()
    if (ms > 2_147_483_647) return // beyond setTimeout's range (~24 days): nobody keeps a tab that long
    const t = setTimeout(() => setLocked(true), Math.max(0, ms))
    return () => clearTimeout(t)
  }, [lockAt])

  const updateHot = useCallback((next: QuestionId[]) => {
    hotRef.current = next
    setHotQs(next)
  }, [])

  /** The server dropped stored 🔥 that no longer qualify with its own (possibly fresher) odds. */
  const dropPruned = useCallback(
    (ids: readonly string[]) => {
      if (!ids.length) return
      hotAccepted.current = hotAccepted.current.filter((h) => !ids.includes(h))
      const pruned = hotRef.current.filter((h) => ids.includes(h))
      if (pruned.length) {
        updateHot(hotRef.current.filter((h) => !ids.includes(h)))
        setNotes((n) => ({ ...n, ...Object.fromEntries(pruned.map((h) => [h, HOT_DROPPED])) }))
      }
      router.refresh() // fetch the fresher odds, so the 🔥 toggles agree with the server
    },
    [router, updateHot],
  )

  /**
   * Sends pending changes, answers first then hot takes (the server checks a 🔥 against the saved
   * answer). One loop at a time, so saves stay sequential and each one carries the version the
   * previous one returned; changes made meanwhile are picked up once their debounce expires.
   */
  const flush = useCallback((): Promise<boolean> => {
    if (loop.current) return loop.current
    if (conflictRef.current) return Promise.resolve(false)
    const stopOnConflict = () => {
      conflictRef.current = true
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      setConflict(true)
    }
    const run = async (): Promise<boolean> => {
      setSave({ kind: 'pending' })
      let error: string | null = null
      let savedAt: string | null = null
      let sending: 'answers' | 'hot' | null = null
      try {
        while ((dirty.current.answers || dirty.current.hot) && !timer.current) {
          if (dirty.current.answers) {
            sending = 'answers'
            dirty.current.answers = false
            const res = await withTimeout(saveAnswersAction(answersRef.current, versionRef.current))
            if (!res.ok) {
              dirty.current.answers = true
              if (res.conflict) stopOnConflict()
              else setFieldErrors((res.fieldErrors ?? {}) as Notes)
              error = res.error
              break
            }
            versionRef.current = res.version
            setFieldErrors({})
            savedAt = res.savedAt
            dropPruned(res.prunedHotTakes)
          } else {
            sending = 'hot'
            dirty.current.hot = false
            const sent = hotRef.current
            const res = await withTimeout(saveHotTakesAction({ questions: sent }, versionRef.current))
            if (!res.ok) {
              if (res.conflict) stopOnConflict()
              const { next, rolledBack } = rollbackRefusedHot(hotRef.current, sent, hotAccepted.current)
              if (res.conflict || SESSION_OR_LOCK.test(res.error) || !rolledBack.length) {
                dirty.current.hot = true
                error = res.error
                break
              }
              // The 🔥 just switched on did not qualify for the server (fresher odds): switch it back
              // off and explain on its question, instead of retrying the same refused list forever.
              updateHot(next)
              const note = /^Hot take refusé/.test(res.error) ? HOT_REFUSED : `🔥 ${res.error}`
              setNotes((n) => ({ ...n, ...Object.fromEntries(rolledBack.map((h) => [h, note])) }))
              if (!sameMembers(next, hotAccepted.current)) dirty.current.hot = true // the user's removals
              router.refresh()
            } else {
              versionRef.current = res.version
              hotAccepted.current = sent.filter((h) => !res.prunedHotTakes.includes(h))
              savedAt = res.savedAt
              dropPruned(res.prunedHotTakes)
            }
          }
          sending = null
        }
      } catch {
        if (sending) dirty.current[sending] = true
        error = NETWORK_ERROR
      }
      if (error) setSave({ kind: 'error', message: error })
      else if (timer.current || dirty.current.answers || dirty.current.hot) setSave({ kind: 'pending' })
      else setSave({ kind: 'saved', at: savedAt })
      return error === null
    }
    const p = run().finally(() => {
      if (loop.current === p) loop.current = null
    })
    loop.current = p
    return p
  }, [router, updateHot, dropPruned])

  const markDirty = useCallback(
    (kind: 'answers' | 'hot') => {
      dirty.current[kind] = true
      if (conflictRef.current) return // kept pending, never sent: the page must be reloaded first
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void flush()
      }, SAVE_DEBOUNCE_MS)
      setSave({ kind: 'pending' })
    },
    [flush],
  )

  // Stale 🔥 hidden at load: remove them on the server too.
  useEffect(() => {
    if (boot.stale.length) markDirty('hot')
  }, [boot, markDirty])

  /** Skips the debounce and waits until everything is on the server (false if a save failed). */
  const flushNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const ok = await flush()
    // A loop that was already finishing may have left the latest change behind.
    if (ok && (dirty.current.answers || dirty.current.hot)) return flush()
    return ok
  }, [flush])

  const hasPending = () => !!(timer.current || loop.current || dirty.current.answers || dirty.current.hot)

  // Don't lose the last pick: warn before closing, and save right away when the tab is hidden
  // (mobile browsers may kill a backgrounded page before the debounce fires).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // After a conflict the pending edits can't be saved: let "Recharger la page" go through.
      if (conflictRef.current || !hasPending()) return
      e.preventDefault()
      e.returnValue = '' // older Safari only honours returnValue
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && timer.current) void flushNow()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flushNow])

  function setPick(q: QuestionId, pick: string | null) {
    if (conflictRef.current) return
    const res = applyPick(answersRef.current, hotRef.current, q, pick, odds)
    answersRef.current = res.answers
    setAnswers(res.answers)

    const fresh: Notes = {}
    if (res.clearedChampion) fresh.champion = 'Ton champion n’est plus l’un de tes finalistes : choisis-le à nouveau.'
    for (const h of res.droppedHot) {
      if (h === q && !pick) continue // cleared on purpose: no need to explain
      fresh[h] = (fresh[h] ? `${fresh[h]} ` : '') + HOT_DROPPED
    }
    setNotes((n) => ({ ...withoutKeys(n, [q, ...(res.clearedChampion ? ['champion'] : [])]), ...fresh }))
    setFieldErrors((e) => withoutKeys(e, [q, 'champion']))

    if (res.droppedHot.length) {
      updateHot(res.hotQuestions)
      markDirty('hot')
    }
    markDirty('answers')
  }

  function toggleHot(q: QuestionId) {
    if (conflictRef.current) return
    const cur = hotRef.current
    if (cur.includes(q)) updateHot(cur.filter((h) => h !== q))
    else if (hotTakeState(q, answersRef.current, cur, odds).enabled) updateHot([...cur, q])
    else return
    setNotes((n) => withoutKeys(n, [q]))
    markDirty('hot')
  }

  async function goToRecap(e: MouseEvent<HTMLAnchorElement>) {
    // After a conflict nothing more can be saved here: the recap shows the stored version.
    if (conflictRef.current || !hasPending()) return
    e.preventDefault()
    // Stay here if the save failed, so the error (and the retry button) stay visible.
    if (await flushNow()) router.push('/recap')
  }

  // Labels for the bookmakers' favorites, per option list (player and coach ids could collide).
  const byId = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(options) as (keyof OptionLists)[]).map((k) => [k, new Map(options[k].map((o) => [o.id, o]))]),
      ) as Record<keyof OptionLists, Map<string, PickerOption>>,
    [options],
  )

  const count = answeredCount(answers)
  const total = questions.length
  const firstOpen = questions.find((q) => !answers[q.id])

  // Finals MVP: allowed from any team, but flag a pick outside the user's champion.
  const fmvp = answers.fmvp ? byId.player.get(answers.fmvp) : undefined
  const fmvpTeam = fmvp ? optionTeam('player', fmvp) : null
  const fmvpWarning =
    fmvp && answers.champion && fmvpTeam?.abbr !== answers.champion
      ? `${fmvp.label} ne joue pas pour ton champion (${TEAM[answers.champion]?.shortName ?? answers.champion}). C’est permis, mais le MVP des Finales vient presque toujours de l’équipe championne.`
      : null
  const fmvpPrefer = useMemo(
    () => (answers.champion ? [answers.champion] : [answers.finalistE, answers.finalistW].filter((x): x is string => !!x)),
    [answers.champion, answers.finalistE, answers.finalistW],
  )

  function renderPicker(q: QuestionDef, titleId: string) {
    const value = answers[q.id] ?? null
    const onChange = (id: string | null) => setPick(q.id, id)
    if (q.kind === 'champion')
      return (
        <ChampionPicker
          finalistE={answers.finalistE ?? null}
          finalistW={answers.finalistW ?? null}
          value={value}
          onChange={onChange}
          labelledBy={titleId}
          disabled={readOnly}
        />
      )
    if (q.kind === 'team' || q.kind === 'teamE' || q.kind === 'teamW')
      return (
        <TeamPicker
          name={`q-${q.id}`}
          options={options[q.kind]}
          value={value}
          onChange={onChange}
          labelledBy={titleId}
          disabled={readOnly}
        />
      )
    return (
      <Combobox
        kind={q.kind}
        options={options[q.kind]}
        value={value}
        onChange={onChange}
        labelledBy={titleId}
        placeholder={q.kind === 'coach' ? 'Rechercher un coach ou une équipe…' : 'Rechercher un joueur ou une équipe…'}
        prefer={q.id === 'fmvp' ? fmvpPrefer : undefined}
        disabled={readOnly}
      />
    )
  }

  function renderFavorites(q: QuestionDef) {
    const market = odds[q.id]
    if (!market || !Object.keys(market).length)
      return <p className={`small muted ${styles.fav}`}>Pas de cote des bookmakers pour cette question.</p>
    const list = byId[listFor(q.kind)]
    const fallback = q.kind === 'rookie' ? byId.player : undefined
    const label = (id: string) => {
      const o = list.get(id) ?? fallback?.get(id)
      if (!o) return 'Hors liste'
      const team = q.kind === 'player' || q.kind === 'rookie' ? optionTeam(q.kind, o) : null
      return team ? `${o.label} (${team.abbr})` : o.label
    }
    const pick = answers[q.id]
    const top = topFavorites(market, 3)
    return (
      <div className={styles.fav}>
        <p className={styles.favTitle}>Favoris des bookmakers</p>
        <ol className={styles.favList} role="list">
          {top.map(({ id, p }, i) => (
            <li key={id} data-mine={id === pick}>
              <span className={styles.favRank} aria-hidden>
                {i + 1}.
              </span>
              <span className={styles.favName}>{label(id)}</span>
              <span className="tabular">{formatPct(p)}</span>
            </li>
          ))}
        </ol>
        {pick && !top.some((f) => f.id === pick) && (
          <p className="small muted">
            Ton choix : {market[pick] !== undefined ? formatPct(market[pick]) : 'pas dans les cotes'}
          </p>
        )}
      </div>
    )
  }

  const saveText =
    save.kind === 'pending'
      ? 'Enregistrement…'
      : save.kind === 'saved'
        ? `Enregistré ✓${save.at ? ` à ${new Date(save.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`
        : save.kind === 'error'
          ? 'Pas enregistré'
          : 'Enregistrement auto'

  return (
    <div className={styles.root}>
      <div className={`card ${styles.tools}`}>
        <div className={styles.toolsRow}>
          <span className={`badge ${hotQs.length ? 'badge-fire' : ''}`}>
            🔥 {hotQs.length}/{SCORING.htMaxQuestions} hot takes questions
          </span>
          <label className={styles.switch}>
            <input type="checkbox" role="switch" checked={showFav} onChange={(e) => setShowFav(e.target.checked)} />
            Voir les favoris des bookmakers
          </label>
        </div>
        <p className="small muted">
          Masqués par défaut pour ne pas t’influencer. Cotes DraftKings du {oddsAsOf}, marge du bookmaker retirée.
        </p>
      </div>

      {locked && (
        <p className="notice notice-warn" role="status">
          C’est verrouillé : le premier match a commencé, tes réponses sont définitives.{' '}
          <Link href={ownPage}>Voir mes pronos</Link>
        </p>
      )}

      <fieldset className={styles.fieldset} disabled={readOnly}>
        <legend className="visually-hidden">Tes réponses aux {total} questions</legend>
        {questions.map((q, i) => {
          const titleId = `q-${q.id}-title`
          const htId = `q-${q.id}-ht`
          const ht = hotTakeState(q.id, answers, hotQs, odds)
          return (
            <section
              key={q.id}
              id={`q-${q.id}`}
              aria-labelledby={titleId}
              className={`card ${styles.card}`}
              data-answered={!!answers[q.id]}
            >
              <div className={styles.head}>
                <span className={styles.num} aria-hidden>
                  {i + 1}
                </span>
                <h2 id={titleId} className={styles.title}>
                  {q.label}
                </h2>
                <span className={`badge ${styles.pts}`}>{q.points} pts</span>
              </div>
              <p className={`small muted ${styles.when}`}>Verdict : {q.resolvesAt}</p>

              {renderPicker(q, titleId)}

              {notes[q.id] && (
                <p className="notice notice-warn small" role="status">
                  {notes[q.id]}
                </p>
              )}
              {fieldErrors[q.id] && (
                <p className="notice notice-err small" role="alert">
                  {fieldErrors[q.id]}
                </p>
              )}
              {q.id === 'fmvp' && fmvpWarning && <p className="notice notice-warn small">{fmvpWarning}</p>}
              {showFav && renderFavorites(q)}

              <div className={styles.hot}>
                <button
                  type="button"
                  className={ht.on ? `btn btn-sm badge-fire ${styles.hotBtn}` : `btn btn-sm ${styles.hotBtn}`}
                  aria-pressed={ht.on}
                  aria-describedby={htId}
                  disabled={!ht.enabled}
                  onClick={() => toggleHot(q.id)}
                >
                  🔥 Hot take
                </button>
                <div id={htId} className={`small muted ${styles.hotText}`}>
                  <p>
                    {ht.reason ??
                      (ht.on
                        ? `Déclaré ! Si ça tombe : +${q.points} pts de bonus (points doublés).`
                        : `À contre-courant ? Allume le 🔥 : points doublés si ça tombe.`)}
                  </p>
                  {ht.noMarket && (
                    <p>Pas de cote : pour être retenu, il faudra être le seul du groupe à faire ce choix.</p>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </fieldset>

      <section className={`card ${styles.end}`} aria-labelledby="questions-end">
        <h2 id="questions-end" className={styles.title}>
          {count === total ? 'Tout est rempli !' : `Encore ${total - count} question${total - count > 1 ? 's' : ''}`}
        </h2>
        <p className="small muted">
          {count === total
            ? 'Tu peux encore changer d’avis jusqu’au verrouillage. Dernière étape : vérifier que tout est valide.'
            : 'Pas de stress : tes choix sont enregistrés, tu peux revenir quand tu veux avant le verrouillage.'}
        </p>
        <div className="row">
          <Link href="/recap" className="btn btn-primary" onClick={goToRecap}>
            Voir mon récap →
          </Link>
          <Link href="/grille" className="btn">
            Ma grille
          </Link>
          <ShareButton
            pseudo={pseudo}
            kind="questions"
            // The image is drawn from the saved answers: wait for the last save.
            disabled={save.kind === 'pending' || save.kind === 'error' || conflict}
            disabledReason="Attends la fin de l’enregistrement."
            cacheKey={(save.kind === 'saved' ? save.at : null) ?? lastSavedAt ?? ''}
          />
        </div>
      </section>

      <div className={styles.bar}>
        <div className={styles.progress}>
          <span className="small">
            <strong className="tabular">{count}</strong>/{total} réponses
          </span>
          <span className={styles.meter} aria-hidden>
            <span style={{ width: `${(count / total) * 100}%` }} />
          </span>
        </div>
        {firstOpen && (
          <a
            href={`#q-${firstOpen.id}`}
            className={`btn btn-ghost btn-sm ${styles.next}`}
            aria-label={`Aller à la prochaine question sans réponse : ${firstOpen.short}`}
          >
            À remplir ↓
          </a>
        )}
        <span className={styles.status} role="status" data-kind={save.kind}>
          {saveText}
        </span>
        {conflict ? (
          <div className={styles.error} role="alert">
            <span>{CONFLICT_NOTICE}</span>
            <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
          </div>
        ) : save.kind === 'error' && (
          <div className={styles.error} role="alert">
            <span>{save.message}</span>
            {/reconnecte/i.test(save.message) ? (
              <Link href="/connexion" className="btn btn-sm">
                Me reconnecter
              </Link>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => void flushNow()}>
                Réessayer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
