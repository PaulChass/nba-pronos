'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { saveGridAction, saveHotTakesAction } from '@/app/actions/predictions'
import { QUESTION_BY_ID } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import { SEASON } from '@/config/season'
import type { Conf, GridPrediction, QuestionId, TeamAbbr } from '@/lib/types'
import { balanceGrid, CONFS, gridStatus, teamHotTakeAllowed } from '@/lib/validation'
import { ConferenceList } from './ConferenceList'
import {
  CONF_LABEL,
  filledInConf,
  formatInt,
  formatSavedAt,
  moveTeam,
  sameMembers,
  sortConfByWins,
  stepWins,
  totalLabel,
  withWins,
  type GridTeam,
  type Tone,
} from './grid-utils'
import { createSerialQueue } from './save-queue'
import type { RowHandlers } from './TeamRow'
import styles from './GridEditor.module.css'

type SaveResult = Awaited<ReturnType<typeof saveGridAction>>

export interface GridEditorProps {
  initialGrid: GridPrediction
  initialHotTeams: TeamAbbr[]
  /**
   * Question hot takes are edited on /questions (saving team hot takes keeps them on the server);
   * only used here to name the ones a grid save drops.
   */
  initialHotQuestions: QuestionId[]
  /** Version of the stored prediction this page was rendered from (0 = never saved). */
  initialVersion: number
  /** Last save from an earlier visit (ISO), null if the user never saved. */
  lastSavedAt: string | null
  /** Lock instant (ISO), from lockAt() on the server. */
  lockAt: string
  /** NORMALIZED_LINES: bookmaker lines rescaled to 1230 wins. */
  lines: Record<TeamAbbr, number>
  linesSource: string
  teams: Record<TeamAbbr, GridTeam>
}

const AUTOSAVE_MS = 1000
const MESSAGE_MS = 7000
const TEAM_COUNT = 30
/** Refreshes after the lock: the browser clock may run ahead of the server's, so one is not enough. */
const LOCK_REFRESH_MS = [0, 2_000, 5_000, 15_000]
const NETWORK_ERROR = 'Connexion perdue : tes derniers changements ne sont pas enregistrés.'

interface Message {
  tone: Tone
  text: string
}

export function GridEditor({
  initialGrid,
  initialHotTeams,
  initialHotQuestions,
  initialVersion,
  lastSavedAt,
  lockAt,
  ...props
}: GridEditorProps) {
  const router = useRouter()
  // Static data: frozen at mount so the server re-render after each save (new object
  // identities) does not invalidate every memoized callback and row.
  const [{ teams, lines, linesSource }] = useState(props)

  // Props are only the starting point: a save can re-render this route on the server, and the
  // fresh props must not overwrite what the user is typing. A save made elsewhere (another tab or
  // device) is caught by the version check instead, and the editor asks for a reload.
  const [grid, setGrid] = useState(initialGrid)
  const [hotTeams, setHotTeams] = useState(initialHotTeams)
  const [conf, setConf] = useState<Conf>('E')
  const [showLines, setShowLines] = useState(false)
  const [locked, setLocked] = useState(false)
  /** Server message once a save was refused because the prediction changed elsewhere. */
  const [conflict, setConflict] = useState<string | null>(null)

  // Save state.
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(0) // save rounds queued or running
  const [queue] = useState(() =>
    createSerialQueue({ onSizeChange: setBusy, onError: (e) => console.error('Grid save failed', e) }),
  )
  const [saved, setSaved] = useState<{ at: string; thisVisit: boolean } | null>(
    lastSavedAt ? { at: lastSavedAt, thisVisit: false } : null,
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Refs mirror the latest values for timers, unload handlers and stable callbacks.
  const gridRef = useRef(initialGrid)
  const hotTeamsRef = useRef(initialHotTeams)
  const hotQuestionsRef = useRef(initialHotQuestions)
  // What the server holds, as far as this tab knows: a round sends only what differs.
  const serverGridRef = useRef(initialGrid)
  const serverHotRef = useRef(initialHotTeams)
  /** Version of the last save this tab knows about, sent back with every save. */
  const versionRef = useRef(initialVersion)
  const pendingRef = useRef<GridPrediction | null>(null)
  const roundQueuedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockedRef = useRef(false)
  const conflictRef = useRef(false)

  const status = useMemo(() => gridStatus(grid), [grid])
  const balanced = useMemo(() => balanceGrid(grid), [grid])
  const violations = useMemo(() => new Set(status.orderViolations), [status])

  // A declared team hot take only counts while it still qualifies with the current wins. It is
  // dropped for good at the next save, so a value typed digit by digit does not lose it.
  const hotOn = useMemo(() => new Set(hotTeams.filter((a) => teamHotTakeAllowed(grid, a))), [hotTeams, grid])
  const hotBlocked = useMemo(() => {
    const out: Partial<Record<TeamAbbr, string | null>> = {}
    for (const abbr of Object.keys(teams)) {
      if (hotOn.has(abbr)) out[abbr] = null
      else if (grid.wins[abbr] === null || grid.wins[abbr] === undefined)
        out[abbr] = 'Donne d’abord un nombre de victoires à cette équipe.'
      else if (!teamHotTakeAllowed(grid, abbr))
        out[abbr] = `Hot take possible seulement à ${SCORING.htTeamMinGap} victoires ou plus d’écart avec Vegas.`
      else if (hotOn.size >= SCORING.htMaxTeams)
        out[abbr] = `Tu as déjà ${SCORING.htMaxTeams} hot takes équipes : retires-en un d’abord.`
      else out[abbr] = null
    }
    return out
  }, [grid, hotOn, teams])

  const showMessage = useCallback((tone: Tone, text: string) => setMessage({ tone, text }), [])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), MESSAGE_MS)
    return () => clearTimeout(t)
  }, [message])

  // ------------------------------------------------------------------ saving

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /**
   * One server call, sent with the version of the last save this tab knows about. Calls only run
   * inside the serial queue, so two requests never carry the same expected version.
   */
  const call = useCallback(
    async (action: (expectedVersion: number) => Promise<SaveResult>): Promise<SaveResult | null> => {
      if (lockedRef.current || conflictRef.current) return null
      let res: SaveResult
      try {
        res = await action(versionRef.current)
      } catch {
        res = { ok: false, error: NETWORK_ERROR }
      }
      if (res.ok) {
        versionRef.current = res.version
        setSaved({ at: res.savedAt, thisVisit: true })
      } else if (res.conflict) {
        // Saved from another tab or device since this page loaded: stop rather than overwrite it.
        conflictRef.current = true
        clearTimer()
        setConflict(res.error)
      }
      return res
    },
    [clearTimer],
  )

  /**
   * Team hot takes to send, or null when the server already has them. The server checks them
   * against the saved wins, so a team that only qualifies with wins not saved yet waits for the
   * next round (it comes right after that grid save).
   */
  const hotTeamsToSync = useCallback((): TeamAbbr[] | null => {
    const list = hotTeamsRef.current.filter((a) => teamHotTakeAllowed(serverGridRef.current, a))
    return sameMembers(list, serverHotRef.current) ? null : list
  }, [])

  /** Removes hot takes locally (after a grid change or a server prune) and says so. */
  const dropHotTakes = useCallback(
    (ids: string[]) => {
      const teamIds = ids.filter((id) => hotTeamsRef.current.includes(id))
      const questionIds = ids.filter((id) => hotQuestionsRef.current.includes(id as QuestionId)) as QuestionId[]
      if (!teamIds.length && !questionIds.length) return
      hotTeamsRef.current = hotTeamsRef.current.filter((a) => !teamIds.includes(a))
      hotQuestionsRef.current = hotQuestionsRef.current.filter((q) => !questionIds.includes(q))
      setHotTeams(hotTeamsRef.current)
      const parts: string[] = []
      if (teamIds.length)
        parts.push(
          `${teamIds.map((a) => teams[a]?.shortName ?? a).join(', ')} : moins de ${SCORING.htTeamMinGap} victoires d’écart avec Vegas`,
        )
      if (questionIds.length)
        parts.push(
          `${questionIds.map((q) => QUESTION_BY_ID[q]?.short ?? q).join(', ')} : choix plus assez audacieux selon les bookmakers`,
        )
      showMessage('warn', `🔥 Hot take retiré (${parts.join(' ; ')}).`)
    },
    [teams, showMessage],
  )

  /**
   * One save round, run by the serial queue: the latest pending grid first (the server checks hot
   * takes against the saved wins), then the team hot takes if they differ from the server's.
   */
  const saveRound = useCallback(async () => {
    roundQueuedRef.current = false
    const g = pendingRef.current
    if (g && !lockedRef.current && !conflictRef.current) {
      pendingRef.current = null
      setDirty(false)
      // Same pruning as the server, on the grid being sent.
      dropHotTakes(hotTeamsRef.current.filter((a) => !teamHotTakeAllowed(g, a)))
      const res = await call((v) => saveGridAction(g, v))
      if (!res) return
      if (!res.ok) {
        // Keep it pending: "Réessayer", the next edit or leaving the page sends it again. The
        // hot takes wait too: the server would check them against the old wins.
        if (!pendingRef.current) {
          pendingRef.current = gridRef.current
          setDirty(true)
        }
        if (!res.conflict) setSaveError(res.error) // whatever follows, so "Réessayer" stays
        return
      }
      serverGridRef.current = g
      serverHotRef.current = serverHotRef.current.filter((a) => !res.prunedHotTakes.includes(a))
      setSaveError(null)
      // Teams were already dropped locally before sending. A team the server still reports was
      // declared again since then and is sent just below: only question hot takes apply here.
      dropHotTakes(res.prunedHotTakes.filter((id) => !(id in teams)))
    }

    const hot = hotTeamsToSync()
    if (!hot) return
    const res = await call((v) => saveHotTakesAction({ teams: hot }, v))
    if (!res || (!res.ok && res.conflict)) return
    if (res.ok) {
      serverHotRef.current = hot.filter((a) => !res.prunedHotTakes.includes(a))
      dropHotTakes(res.prunedHotTakes)
      return
    }
    // Refused or lost: show what the server really holds. Not a failed grid save, so the grid's
    // status line is left alone.
    hotTeamsRef.current = serverHotRef.current
    setHotTeams(serverHotRef.current)
    showMessage('err', `🔥 ${res.error}`)
  }, [call, hotTeamsToSync, dropHotTakes, showMessage, teams])

  /**
   * Saves what is pending now (debounce elapsed, hot-take toggle, leaving the page). Saves run one
   * at a time; a round already waiting in the queue picks up the latest grid when it starts.
   */
  const flush = useCallback(() => {
    clearTimer()
    if (lockedRef.current || conflictRef.current || roundQueuedRef.current) return
    // Nothing to send. (While a round runs, queue one anyway: it compares with its result.)
    if (!pendingRef.current && !queue.size && !hotTeamsToSync()) return
    roundQueuedRef.current = true
    void queue.push(saveRound)
  }, [queue, saveRound, hotTeamsToSync, clearTimer])

  /** Every grid edit goes through here: local state now, debounced autosave later. */
  const update = useCallback(
    (fn: (g: GridPrediction) => GridPrediction) => {
      if (lockedRef.current || conflictRef.current) return
      const next = fn(gridRef.current)
      if (next === gridRef.current) return
      gridRef.current = next
      pendingRef.current = next
      setGrid(next)
      setDirty(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush],
  )

  // Leaving the page, switching app on a phone, or unmounting: send what is pending.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // After a conflict or the lock nothing more can be saved (and "Recharger" must not ask).
      if (lockedRef.current || conflictRef.current) return
      if (!pendingRef.current && !queue.size) return
      flush()
      e.preventDefault() // asks the browser to confirm while the save completes
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [flush, queue])

  // At the lock, freeze the editor and let the server page redirect to the public page. The
  // browser clock may run ahead of the server's (the server would still render the editor), so
  // refresh a few times; the redirect unmounts the editor, which clears the remaining timers.
  useEffect(() => {
    const ms = Date.parse(lockAt) - Date.now()
    if (Number.isNaN(ms) || ms > 2_000_000_000) return // beyond setTimeout's range
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(
      setTimeout(
        () => {
          lockedRef.current = true
          clearTimer()
          setLocked(true)
          for (const d of LOCK_REFRESH_MS) timers.push(setTimeout(() => router.refresh(), d))
        },
        Math.max(0, ms),
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [lockAt, router, clearTimer])

  // ------------------------------------------------------------------ row handlers

  const announce = useCallback((text: string) => setAnnouncement(text), [])

  const toggleHot = useCallback(
    (abbr: TeamAbbr) => {
      if (lockedRef.current || conflictRef.current) return
      const g = gridRef.current
      const prev = hotTeamsRef.current
      const wasOn = prev.includes(abbr) && teamHotTakeAllowed(g, abbr)
      const effective = prev.filter((a) => a !== abbr && teamHotTakeAllowed(g, a))
      if (!wasOn) {
        const reason =
          g.wins[abbr] === null || g.wins[abbr] === undefined
            ? 'Donne d’abord un nombre de victoires à cette équipe.'
            : !teamHotTakeAllowed(g, abbr)
              ? `Hot take possible seulement à ${SCORING.htTeamMinGap} victoires ou plus d’écart avec Vegas.`
              : effective.length >= SCORING.htMaxTeams
                ? `Tu as déjà ${SCORING.htMaxTeams} hot takes équipes : retires-en un d’abord.`
                : null
        if (reason) return showMessage('neutral', `🔥 ${reason}`)
      }
      const next = wasOn ? effective : [...effective, abbr]
      hotTeamsRef.current = next
      setHotTeams(next)
      announce(`${teams[abbr].shortName} : hot take ${wasOn ? 'retiré' : 'déclaré'} (${next.length}/${SCORING.htMaxTeams}).`)
      // Saved right away by a round: the pending grid first, then the hot takes (see saveRound).
      flush()
    },
    [teams, flush, showMessage, announce],
  )

  const handlers = useMemo<RowHandlers>(
    () => ({
      onWins: (abbr, wins) => update((g) => withWins(g, abbr, wins)),
      onStep: (abbr, delta) => update((g) => withWins(g, abbr, stepWins(g.wins[abbr] ?? null, delta))),
      onMove: (abbr, delta) => {
        const c = teams[abbr].conference
        update((g) => {
          const i = g.order[c].indexOf(abbr)
          return moveTeam(g, c, i, i + delta)
        })
        announce(`${teams[abbr].shortName} : rang ${gridRef.current.order[c].indexOf(abbr) + 1}.`)
      },
      onHot: toggleHot,
      onEnter: (abbr) => {
        const list = gridRef.current.order[teams[abbr].conference]
        const nextAbbr = list[list.indexOf(abbr) + 1]
        const input = nextAbbr
          ? document.querySelector<HTMLInputElement>(`[data-wins-input="${nextAbbr}"]`)
          : null
        if (input) {
          input.focus({ preventScroll: true })
          input.closest('li')?.scrollIntoView({ block: 'nearest' })
        } else (document.activeElement as HTMLElement | null)?.blur()
      },
    }),
    [update, toggleHot, announce, teams],
  )

  const onReorder = useCallback(
    (c: Conf, from: number, to: number) => update((g) => moveTeam(g, c, from, to)),
    [update],
  )

  // ------------------------------------------------------------------ toolbar & bar actions

  const sortByWins = () => {
    const before = gridRef.current
    update((g) => sortConfByWins(g, conf))
    announce(
      gridRef.current === before
        ? `${CONF_LABEL[conf]} : déjà trié par victoires.`
        : `${CONF_LABEL[conf]} trié par victoires.`,
    )
  }

  const missing = TEAM_COUNT - status.filled
  const balanceBlocked =
    missing > 0
      ? missing === 1
        ? 'Remplis d’abord la dernière équipe.'
        : `Remplis d’abord les ${missing} équipes restantes.`
      : status.orderViolations.length
        ? 'Corrige d’abord les équipes en rouge : aucune ne peut avoir plus de victoires que celle classée au-dessus.'
        : status.delta === 0
          ? `Ta grille fait déjà pile ${formatInt(SEASON.totalWins)} victoires.`
          : !balanced
            ? 'Impossible d’équilibrer sans sortir de 0 à 82 victoires : ajuste quelques équipes à la main.'
            : null

  const onBalance = () => {
    if (balanceBlocked || !balanced) return showMessage('neutral', balanceBlocked ?? '')
    update((g) => balanceGrid(g) ?? g)
    announce(`Grille équilibrée : ${formatInt(SEASON.totalWins)} victoires, ordre inchangé.`)
  }

  const retry = () => {
    if (!pendingRef.current) pendingRef.current = gridRef.current
    setDirty(true)
    setSaveError(null) // "Enregistrement…" meanwhile; a new failure shows it again
    flush()
  }

  /**
   * "Étape suivante": waits for the saves before leaving, so /questions loads the latest version
   * (otherwise its first save could be refused as a conflict). Stays here if a save failed.
   */
  const goToQuestions = (e: MouseEvent<HTMLAnchorElement>) => {
    flush()
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !queue.size) return
    e.preventDefault()
    const href = e.currentTarget.getAttribute('href') ?? '/questions'
    void queue.idle().then(() => {
      if (!conflictRef.current && !lockedRef.current && !pendingRef.current) router.push(href)
    })
  }

  const reload = () => window.location.reload()

  // Tabs: arrows / Home / End move between Est and Ouest (WAI-ARIA tabs pattern).
  const tabRefs = useRef<Partial<Record<Conf, HTMLButtonElement | null>>>({})
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = CONFS.indexOf(conf)
    const target =
      e.key === 'ArrowRight'
        ? CONFS[(i + 1) % CONFS.length]
        : e.key === 'ArrowLeft'
          ? CONFS[(i + CONFS.length - 1) % CONFS.length]
          : e.key === 'Home'
            ? CONFS[0]
            : e.key === 'End'
              ? CONFS[CONFS.length - 1]
              : null
    if (!target) return
    e.preventDefault()
    setConf(target)
    tabRefs.current[target]?.focus()
  }

  // ------------------------------------------------------------------ render

  const total = totalLabel(status.filled, status.delta, TEAM_COUNT)
  const gaugePct = Math.min(100, (status.total / SEASON.totalWins) * 100)
  const showErrors = status.filled === TEAM_COUNT && !status.valid
  const saving = dirty || busy > 0
  // After a conflict nothing more can be saved: the editor is read-only until the reload.
  const frozen = locked || conflict !== null

  let saveText: string
  if (locked) saveText = 'Verrouillé'
  else if (conflict) saveText = 'Non enregistré'
  else if (saveError) saveText = saveError
  else if (saving) saveText = 'Enregistrement…'
  else if (saved) saveText = `Enregistré ✓ ${formatSavedAt(saved.at, !saved.thisVisit)}`
  else saveText = 'Rien d’enregistré pour l’instant'

  return (
    <div className={styles.editor}>
      {locked && (
        <p className="notice notice-warn" role="alert">
          C’est verrouillé : le premier match a commencé. Ta grille est figée.
        </p>
      )}

      <div className={`tabs ${styles.tabs}`} role="tablist" aria-label="Conférence">
        {CONFS.map((c) => {
          const n = filledInConf(grid, c)
          const hasViolation = status.orderViolations.some((a) => teams[a]?.conference === c)
          return (
            <button
              key={c}
              ref={(el) => {
                tabRefs.current[c] = el
              }}
              type="button"
              role="tab"
              id={`grille-tab-${c}`}
              aria-selected={conf === c}
              aria-controls="grille-panel"
              tabIndex={conf === c ? 0 : -1}
              className="tab"
              onClick={() => setConf(c)}
              onKeyDown={onTabKey}
            >
              <span className={c === 'E' ? styles.dotEast : styles.dotWest} aria-hidden />
              {CONF_LABEL[c]}
              <span className={`${styles.tabCount} tabular`}>
                {n}/15
                <span className="visually-hidden"> équipes remplies</span>
              </span>
              {hasViolation && (
                <span className={styles.tabAlert} title="Ordre à corriger">
                  <span aria-hidden>!</span>
                  <span className="visually-hidden">, ordre à corriger</span>
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className={styles.toolbar}>
        <button type="button" className="btn btn-sm" onClick={sortByWins} disabled={frozen}>
          Trier par victoires
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={showLines}
          onClick={() => setShowLines((v) => !v)}
        >
          {showLines ? 'Masquer les lignes Vegas' : 'Voir les lignes Vegas'}
        </button>
      </div>
      {showLines && (
        <p className="small muted">
          Lignes de victoires ({linesSource}) ramenées à {formatInt(SEASON.totalWins)} victoires au total. Juste un
          repère : tu n’es pas obligé de les suivre.
        </p>
      )}

      <p className={`small ${styles.hotInfo}`}>
        <span className="badge badge-fire">
          🔥 {hotOn.size}/{SCORING.htMaxTeams}
        </span>{' '}
        Hot takes : touche 🔥 sur une équipe où tu vas à contre-courant (au moins {SCORING.htTeamMinGap} victoires
        d’écart avec Vegas). Réussi : +{SCORING.htTeamBonus} pts.{' '}
        <Link href="/regles#hot-takes">Comment ça marche</Link>
      </p>

      <div role="tabpanel" id="grille-panel" aria-labelledby={`grille-tab-${conf}`}>
        <ConferenceList
          key={conf}
          conf={conf}
          grid={grid}
          teams={teams}
          lines={lines}
          showLines={showLines}
          warnings={status.warnings}
          violations={violations}
          hotOn={hotOn}
          hotBlocked={hotBlocked}
          locked={frozen}
          handlers={handlers}
          onReorder={onReorder}
        />
      </div>

      {showErrors && (
        <div className="notice notice-err" role="status">
          <strong>Ta grille n’est pas encore valide :</strong>
          <ul className={styles.errors}>
            {status.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <section className={styles.bar} aria-label="Total et enregistrement">
        <div className={styles.barMain}>
          <p className={styles.total}>
            <span className={`${styles.totalNum} tabular`}>{formatInt(status.total)}</span>
            <span className={`${styles.totalMax} tabular`}> / {formatInt(SEASON.totalWins)}</span>
            <span className={`${styles.delta} ${styles[`tone_${total.tone}`]}`}>{total.text}</span>
          </p>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onBalance}
            aria-disabled={frozen || balanceBlocked !== null}
            disabled={frozen}
            aria-describedby="grille-balance-help"
            title={balanceBlocked ?? 'Ajuste toutes les équipes proportionnellement pour tomber sur 1 230, sans changer l’ordre.'}
          >
            Équilibrer
          </button>
          <span id="grille-balance-help" className="visually-hidden">
            {balanceBlocked ?? 'Ajuste toutes les équipes proportionnellement pour tomber pile sur 1 230, sans changer l’ordre.'}
          </span>
        </div>

        <div className={styles.gauge} aria-hidden>
          <div
            className={`${styles.gaugeFill} ${styles[`gauge_${total.tone}`]}`}
            style={{ width: `${gaugePct}%` }}
          />
        </div>

        <div className={styles.barMeta}>
          {status.valid ? (
            <span className={styles.valid}>
              ✓ Grille valide.{' '}
              <Link href="/questions" onClick={goToQuestions} className={styles.nextLink}>
                Étape suivante : les questions →
              </Link>
            </span>
          ) : (
            <span className="tabular">
              {status.filled}/{TEAM_COUNT} équipes
            </span>
          )}
          <span
            className={`${styles.saveStatus} ${saveError || conflict ? styles.tone_err : ''}`}
            role={saveError && !frozen ? 'alert' : 'status'}
          >
            {saveText}
            {saveError && !frozen && (
              <button type="button" className={styles.retry} onClick={retry}>
                Réessayer
              </button>
            )}
          </span>
        </div>

        {conflict && !locked && (
          // In the sticky bar so it stays in view wherever the user is in the list.
          <div className={`notice notice-err ${styles.conflict}`} role="alert">
            <p>
              <strong>{conflict}</strong> Ta dernière modification ici n’a pas été enregistrée.
            </p>
            <button type="button" className="btn btn-sm btn-primary" onClick={reload}>
              Recharger la page
            </button>
          </div>
        )}

        {message && (
          <p className={`${styles.message} ${styles[`tone_${message.tone}`]}`} role="status">
            <span>{message.text}</span>
            <button type="button" className={styles.close} onClick={() => setMessage(null)} aria-label="Fermer">
              ×
            </button>
          </p>
        )}
      </section>
    </div>
  )
}
