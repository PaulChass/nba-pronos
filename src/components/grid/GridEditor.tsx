'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
  sortConfByWins,
  stepWins,
  totalLabel,
  withWins,
  type GridTeam,
  type Tone,
} from './grid-utils'
import type { RowHandlers } from './TeamRow'
import styles from './GridEditor.module.css'

type SaveResult = Awaited<ReturnType<typeof saveGridAction>>

export interface GridEditorProps {
  initialGrid: GridPrediction
  initialHotTeams: TeamAbbr[]
  /** Question hot takes are edited on /questions; kept here so saving team hot takes preserves them. */
  initialHotQuestions: QuestionId[]
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

interface Message {
  tone: Tone
  text: string
}

export function GridEditor({
  initialGrid,
  initialHotTeams,
  initialHotQuestions,
  lastSavedAt,
  lockAt,
  ...props
}: GridEditorProps) {
  const router = useRouter()
  // Static data: frozen at mount so the server re-render after each save (new object
  // identities) does not invalidate every memoized callback and row.
  const [{ teams, lines, linesSource }] = useState(props)

  // Props are only the starting point: every autosave re-renders this route on the server
  // (revalidatePath), and the fresh props must not overwrite what the user is typing.
  const [grid, setGrid] = useState(initialGrid)
  const [hotTeams, setHotTeams] = useState(initialHotTeams)
  const [conf, setConf] = useState<Conf>('E')
  const [showLines, setShowLines] = useState(false)
  const [locked, setLocked] = useState(false)

  // Save state.
  const [dirty, setDirty] = useState(false)
  const [inFlight, setInFlight] = useState(0)
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
  const pendingRef = useRef<GridPrediction | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)
  const inFlightRef = useRef(0)
  const lockedRef = useRef(false)

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

  /** Runs one server action and tracks it. Next dispatches actions one at a time, in order. */
  const send = useCallback(async (call: () => Promise<SaveResult>, reportErrors = true): Promise<SaveResult> => {
    const seq = ++seqRef.current
    inFlightRef.current++
    setInFlight((n) => n + 1)
    let res: SaveResult
    try {
      res = await call()
    } catch {
      res = { ok: false, error: 'Connexion perdue : tes derniers changements ne sont pas enregistrés.' }
    }
    inFlightRef.current--
    setInFlight((n) => n - 1)
    if (seq === seqRef.current) {
      // Only the latest call decides what the status line says.
      if (res.ok) {
        setSaveError(null)
        setSaved({ at: res.savedAt, thisVisit: true })
      } else if (reportErrors) setSaveError(res.error)
    }
    return res
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

  /** Sends the pending grid now (debounce elapsed, hot-take toggle, leaving the page). */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const g = pendingRef.current
    if (!g || lockedRef.current) return
    pendingRef.current = null
    setDirty(false)
    // Same pruning as the server, on the grid being sent.
    dropHotTakes(hotTeamsRef.current.filter((a) => !teamHotTakeAllowed(g, a)))
    void send(() => saveGridAction(g)).then((res) => {
      if (res.ok) {
        if (res.prunedHotTakes.length) dropHotTakes(res.prunedHotTakes)
      } else if (!pendingRef.current) {
        // Keep it pending: "Réessayer", the next edit or leaving the page sends it again.
        pendingRef.current = gridRef.current
        setDirty(true)
      }
    })
  }, [send, dropHotTakes])

  /** Every grid edit goes through here: local state now, debounced autosave later. */
  const update = useCallback(
    (fn: (g: GridPrediction) => GridPrediction) => {
      if (lockedRef.current) return
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
      if (!pendingRef.current && !inFlightRef.current) return
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
  }, [flush])

  // At the lock, freeze the editor and let the server page redirect to the public page.
  useEffect(() => {
    const ms = Date.parse(lockAt) - Date.now()
    if (Number.isNaN(ms) || ms > 2_000_000_000) return // beyond setTimeout's range
    const t = setTimeout(
      () => {
        lockedRef.current = true
        setLocked(true)
        router.refresh()
      },
      Math.max(0, ms),
    )
    return () => clearTimeout(t)
  }, [lockAt, router])

  // ------------------------------------------------------------------ row handlers

  const announce = useCallback((text: string) => setAnnouncement(text), [])

  const toggleHot = useCallback(
    (abbr: TeamAbbr) => {
      if (lockedRef.current) return
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
      // The server checks hot takes against the saved wins: send the pending grid first.
      flush()
      // A refused hot take is reported in the message slot, not as a failed save of the grid.
      void send(() => saveHotTakesAction({ teams: next }), false).then((res) => {
        if (res.ok) {
          if (res.prunedHotTakes.length) dropHotTakes(res.prunedHotTakes)
          return
        }
        if (hotTeamsRef.current === next) {
          hotTeamsRef.current = prev
          setHotTeams(prev)
        }
        showMessage('err', `🔥 ${res.error}`)
      })
    },
    [teams, flush, send, dropHotTakes, showMessage, announce],
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
    flush()
  }

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
  const saving = dirty || inFlight > 0

  let saveText: string
  if (locked) saveText = 'Verrouillé'
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
        <button type="button" className="btn btn-sm" onClick={sortByWins} disabled={locked}>
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
          locked={locked}
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
            aria-disabled={locked || balanceBlocked !== null}
            disabled={locked}
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
              <Link href="/questions" onClick={flush} className={styles.nextLink}>
                Étape suivante : les questions →
              </Link>
            </span>
          ) : (
            <span className="tabular">
              {status.filled}/{TEAM_COUNT} équipes
            </span>
          )}
          <span
            className={`${styles.saveStatus} ${saveError ? styles.tone_err : ''}`}
            role={saveError ? 'alert' : 'status'}
          >
            {saveText}
            {saveError && !locked && (
              <button type="button" className={styles.retry} onClick={retry}>
                Réessayer
              </button>
            )}
          </span>
        </div>

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
