// Consensus: the group's view (median of the valid grids, most popular answers) next to the
// bookmakers and reality. Everything here derives from other players' predictions, so before the
// lock the page shows nothing but a teaser (listPredictionsAfterLock would refuse anyway).
import type { Metadata } from 'next'
import Link from 'next/link'
import { BOOKMAKER_SOURCE, NORMALIZED_LINES } from '@/config/bookmaker-lines'
import { QUESTIONS, type QuestionDef } from '@/config/questions'
import { isLocked, isRegularSeasonOver, lockAt } from '@/config/season'
import { answerLabel, PLAYER_BY_ID, TEAM_BY_ABBR } from '@/lib/data'
import { getStandings, type StandingsResult } from '@/lib/espn'
import { getQuestionOdds } from '@/lib/odds'
import { listPredictionsAfterLock } from '@/lib/predictions'
import { getResults } from '@/lib/results'
import { actualWins, buildLockContext, scoreAll, type LockContext } from '@/lib/scoring'
import type {
  Conf,
  QuestionHotTake,
  QuestionOdds,
  Results,
  ScoreCard,
  StoredPrediction,
  Team,
  TeamAbbr,
  TeamHotTake,
  TeamStanding,
} from '@/lib/types'
import { TEAMS_BY_CONF } from '@/lib/validation'
import styles from './consensus.module.css'

export const metadata: Metadata = { title: 'Consensus' }
// Depends on the clock (lock), the database and ESPN: never prerender.
export const dynamic = 'force-dynamic'

/** Group vs Vegas gap (in wins) from which a team is highlighted. */
const DISAGREE_GAP = 5

const fmt1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const fmtSigned = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const fmtPct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 })

function pct(p: number): string {
  return p > 0 && p < 0.01 ? '< 1 %' : fmtPct.format(p)
}

/** "mardi 20 octobre à 21h00" (Paris time). */
function lockLabel(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.weekday} ${parts.day} ${parts.month} à ${parts.hour}h${parts.minute}`
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---------------------------------------------------------------- data shaping

interface TeamRow {
  team: Team
  median: number | null
  min: number | null
  max: number | null
  line: number
  actual: number | null
  standing: TeamStanding | null
  /** median − line, null without valid grids. */
  gap: number | null
}

function teamRows(valid: StoredPrediction[], actual: Record<TeamAbbr, number> | null, standings: StandingsResult | null): Record<Conf, TeamRow[]> {
  const byAbbr = new Map(standings?.teams.map((s) => [s.abbr, s]))
  const rows = (conf: Conf): TeamRow[] =>
    TEAMS_BY_CONF[conf]
      .map((abbr) => {
        const wins = valid.map((p) => p.grid.wins[abbr]).filter((w): w is number => typeof w === 'number')
        const med = median(wins)
        const line = NORMALIZED_LINES[abbr]
        return {
          team: TEAM_BY_ABBR[abbr],
          median: med,
          min: wins.length ? Math.min(...wins) : null,
          max: wins.length ? Math.max(...wins) : null,
          line,
          actual: actual?.[abbr] ?? null,
          standing: byAbbr.get(abbr) ?? null,
          gap: med === null ? null : med - line,
        }
      })
      // Consensus order: the group's median, then the line for ties / no grids.
      .sort((a, b) => (b.median ?? b.line) - (a.median ?? a.line) || b.line - a.line)
  return { E: rows('E'), W: rows('W') }
}

/** Shared win scale for the little charts (same for both conferences, so they compare). */
function scaleOf(rows: TeamRow[]): { lo: number; hi: number } {
  const vals = rows.flatMap((r) => [r.min, r.max, r.line, r.actual, r.median]).filter((v): v is number => v !== null)
  let lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / 10) * 10)
  let hi = Math.min(82, Math.ceil((Math.max(...vals) + 2) / 10) * 10)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 20) {
    lo = 10
    hi = 70
  }
  return { lo, hi }
}

interface PickStat {
  id: string
  count: number
  share: number // of the whole group
  odds: number | null
  correct: boolean
}

interface QuestionStat {
  q: QuestionDef
  answered: number
  top: PickStat[]
  others: number // distinct picks not shown
  favourite: { id: string; p: number; groupShare: number } | null
  result: Results[QuestionDef['id']]
  winners: string[]
  /** Players who picked one of the winners. */
  found: number
}

function questionStats(preds: StoredPrediction[], odds: QuestionOdds, results: Results): QuestionStat[] {
  const n = preds.length
  return QUESTIONS.map((q) => {
    const counts = new Map<string, number>()
    for (const p of preds) {
      const a = p.answers[q.id]
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1)
    }
    const market = odds[q.id]
    const result = results[q.id]
    const winners = result?.status === 'final' ? result.winners : []
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (market?.[b[0]] ?? 0) - (market?.[a[0]] ?? 0))
    const top = sorted.slice(0, 3).map(([id, count]) => ({
      id,
      count,
      share: n ? count / n : 0,
      odds: market?.[id] ?? null,
      correct: winners.includes(id),
    }))
    let favourite: QuestionStat['favourite'] = null
    if (market) {
      const fav = Object.entries(market).sort((a, b) => b[1] - a[1])[0]
      if (fav) favourite = { id: fav[0], p: fav[1], groupShare: n ? (counts.get(fav[0]) ?? 0) / n : 0 }
    }
    return {
      q,
      answered: [...counts.values()].reduce((a, b) => a + b, 0),
      top,
      others: Math.max(0, sorted.length - top.length),
      favourite,
      result,
      winners,
      found: winners.reduce((a, w) => a + (counts.get(w) ?? 0), 0),
    }
  })
}

interface HotTakeItem {
  key: string
  pseudo: string
  what: string // team or question
  caption: string // template text, no AI
  status: { label: string; tone: 'ok' | 'err' | 'fire' | 'muted' } | null
}

function teamHotTakeStatus(ht: TeamHotTake | null | undefined, final: boolean): HotTakeItem['status'] {
  if (!ht) return null
  if (!ht.eligible) return { label: 'non retenu', tone: 'muted' }
  if (final) return ht.success ? { label: `réussi · +${ht.bonus}`, tone: 'ok' } : { label: 'raté', tone: 'err' }
  return ht.success ? { label: 'en bonne voie', tone: 'ok' } : { label: 'en danger', tone: 'fire' }
}

function questionHotTakeStatus(ht: QuestionHotTake | null | undefined, result: Results[QuestionDef['id']]): HotTakeItem['status'] {
  if (!ht) return null
  if (!ht.eligible) return { label: 'non retenu', tone: 'muted' }
  if (result?.status === 'void') return { label: 'question annulée', tone: 'muted' }
  if (result?.status === 'final')
    return ht.success ? { label: 'tombé · points doublés', tone: 'ok' } : { label: 'raté', tone: 'err' }
  return { label: 'retenu', tone: 'fire' }
}

function hotTakeItems(
  preds: StoredPrediction[],
  ctx: LockContext | null,
  cards: Map<number, ScoreCard>,
  odds: QuestionOdds,
  results: Results,
  final: boolean,
): HotTakeItem[] {
  const items: HotTakeItem[] = []
  for (const p of preds) {
    const card = cards.get(p.userId)
    // Team hot takes only count with a valid grid.
    if (p.gridValid) {
      for (const abbr of p.hotTakes.teams) {
        const w = p.grid.wins[abbr]
        if (typeof w !== 'number') continue
        const team = TEAM_BY_ABBR[abbr]
        const med = ctx?.medianOthers[p.userId]?.[abbr] ?? null
        const caption =
          `${team?.shortName ?? abbr} à ${w} V : ${fmtSigned.format(w - NORMALIZED_LINES[abbr])} sur Vegas` +
          (med !== null ? `, ${fmtSigned.format(w - med)} sur le groupe` : '')
        items.push({
          key: `${p.userId}-${abbr}`,
          pseudo: p.pseudo,
          what: team?.name ?? abbr,
          caption,
          status: teamHotTakeStatus(card?.teams.find((t) => t.abbr === abbr)?.hotTake, final),
        })
      }
    }
    for (const qid of p.hotTakes.questions) {
      const q = QUESTIONS.find((x) => x.id === qid)
      const pick = p.answers[qid]
      if (!q || !pick) continue
      const prob = odds[qid]?.[pick]
      const others = Math.max(0, (ctx?.pickCounts[qid]?.[pick] ?? 1) - 1)
      const caption =
        `${q.short} : ${answerLabel(q.kind, pick)}` +
        (prob !== undefined ? `, ${pct(prob)} selon les bookmakers` : ', sans cote') +
        (ctx ? (others === 0 ? ', choix unique dans le groupe' : `, aussi choisi par ${others} autre${others > 1 ? 's' : ''}`) : '')
      items.push({
        key: `${p.userId}-${qid}`,
        pseudo: p.pseudo,
        what: q.label,
        caption,
        status: questionHotTakeStatus(card?.qs.find((x) => x.id === qid)?.hotTake, results[qid]),
      })
    }
  }
  return items
}

// ---------------------------------------------------------------- page

export default async function ConsensusPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  if (!isLocked()) return <BeforeLock />

  const sp = await searchParams
  const conf: Conf = sp.conf === 'W' ? 'W' : 'E'

  const loaded = await Promise.all([
    listPredictionsAfterLock(),
    getStandings().catch(() => null),
    getResults().catch((): Results => ({})),
    getQuestionOdds(),
  ]).catch(() => null)
  if (!loaded)
    return (
      <div className="stack">
        <h1>Consensus</h1>
        <p className="notice notice-err">Impossible de charger les pronos pour le moment. Réessaie dans un instant.</p>
      </div>
    )
  const [preds, standings, results, { odds }] = loaded

  const final = isRegularSeasonOver()
  const valid = preds.filter((p) => p.gridValid)
  const actual = standings ? actualWins(standings.teams, NORMALIZED_LINES, final) : null
  const rows = teamRows(valid, actual, standings)
  const scale = scaleOf([...rows.E, ...rows.W])
  const ctx = preds.length ? buildLockContext(preds, odds) : null
  let cards = new Map<number, ScoreCard>()
  if (ctx && standings) {
    try {
      cards = new Map(scoreAll(preds, ctx, standings.teams, NORMALIZED_LINES, results, final, (id) => PLAYER_BY_ID[id]?.team).map((c) => [c.userId, c]))
    } catch {
      // statuses are a bonus here: the captions still render without them
    }
  }
  const questions = questionStats(preds, odds, results)
  const hotTakes = hotTakeItems(preds, ctx, cards, odds, results, final)
  const disagreements = [...rows.E, ...rows.W]
    .filter((r) => r.gap !== null && Math.abs(r.gap) >= DISAGREE_GAP)
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))
  const projLabel = final ? 'Final' : 'Proj.'

  return (
    <div className="stack">
      <header className={styles.header}>
        <h1>Consensus</h1>
        <p className="muted">
          L’avis du groupe ({preds.length} joueur{preds.length > 1 ? 's' : ''}, {valid.length} grille
          {valid.length > 1 ? 's' : ''} complète{valid.length > 1 ? 's' : ''}) face aux bookmakers et à la réalité.
        </p>
      </header>

      {/* ------------------------------------------------ teams */}
      <section className="card stack" aria-labelledby="consensus-teams">
        <h2 id="consensus-teams">Les bilans</h2>

        {disagreements.length > 0 && (
          <p className={styles.callout}>
            <strong>Le groupe contre Vegas :</strong>{' '}
            {disagreements.slice(0, 5).map((r, i) => (
              <span key={r.team.abbr}>
                {i > 0 && ', '}
                {r.team.shortName} ({fmtSigned.format(r.gap ?? 0)})
              </span>
            ))}
            .
          </p>
        )}

        <div className="tabs" role="tablist" aria-label="Conférence">
          {(['E', 'W'] as const).map((c) => (
            <Link
              key={c}
              id={`tab-${c}`}
              href={`/consensus?conf=${c}`}
              scroll={false}
              replace
              role="tab"
              aria-selected={conf === c}
              aria-controls="consensus-panel"
              className="tab"
            >
              {c === 'E' ? 'Est' : 'Ouest'}
            </Link>
          ))}
        </div>

        <Legend projLabel={projLabel} hasProj={actual !== null} />

        <div id="consensus-panel" role="tabpanel" aria-labelledby={`tab-${conf}`}>
          {valid.length === 0 && (
            <p className="notice notice-warn">Aucune grille complète : pas de médiane du groupe à afficher.</p>
          )}
          <div className={styles.headRow} aria-hidden>
            <span>Équipe</span>
            <span className={styles.headNum}>Groupe</span>
            <span className={styles.headNum}>Vegas</span>
            <span className={styles.headNum}>{projLabel}</span>
            <span className={styles.headAxis}>
              <span>{scale.lo}</span>
              <span>{Math.round((scale.lo + scale.hi) / 2)}</span>
              <span>{scale.hi}</span>
            </span>
          </div>
          <ol className={styles.teams}>
            {rows[conf].map((r, i) => (
              <TeamLine key={r.team.abbr} row={r} rank={i + 1} scale={scale} projLabel={projLabel} />
            ))}
          </ol>
        </div>

        <p className="small muted">
          Groupe = médiane des grilles complètes (fourchette min–max). Vegas = lignes {BOOKMAKER_SOURCE}, ramenées
          sur 1 230 victoires. {final ? 'Final = bilan de fin de saison régulière.' : 'Proj. = projection du bilan sur 82 matchs.'}
          {standings && (
            <>
              {' '}
              Classement ESPN du{' '}
              {new Intl.DateTimeFormat('fr-FR', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Paris',
              }).format(new Date(standings.fetchedAt))}
              .
            </>
          )}
        </p>
        {!standings && <p className="notice notice-warn">Le classement NBA est momentanément indisponible.</p>}
      </section>

      {/* ------------------------------------------------ questions */}
      <section className="stack" aria-labelledby="consensus-questions">
        <h2 id="consensus-questions">Les questions</h2>
        <div className={styles.questions}>
          {questions.map((s) => (
            <QuestionCard key={s.q.id} stat={s} groupSize={preds.length} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ hot takes */}
      <section className="card stack" aria-labelledby="consensus-hot">
        <h2 id="consensus-hot">Les hot takes du groupe 🔥</h2>
        {hotTakes.length === 0 ? (
          <p className="muted">Personne n’a osé de hot take cette saison.</p>
        ) : (
          <ul className={styles.hotList}>
            {hotTakes.map((h) => (
              <li key={h.key} className={styles.hotItem}>
                <div className={styles.hotHead}>
                  <Link href={`/joueur/${encodeURIComponent(h.pseudo)}`} className={styles.hotPseudo}>
                    {h.pseudo}
                  </Link>
                  <span className="small muted">{h.what}</span>
                  {h.status && <span className={`badge ${toneClass(h.status.tone)}`}>{h.status.label}</span>}
                </div>
                <p className={styles.hotCaption}>
                  <span aria-hidden>🔥 </span>
                  {h.caption}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">
          Un hot take est retenu s’il s’écarte d’au moins 10 victoires de Vegas et du groupe (équipe), ou si le choix
          est rare chez les bookmakers et dans le groupe (question). <Link href="/regles">Le détail dans les règles</Link>.
        </p>
      </section>
    </div>
  )
}

function toneClass(tone: 'ok' | 'err' | 'fire' | 'muted'): string {
  if (tone === 'fire') return 'badge-fire'
  return styles[`tone_${tone}`] ?? ''
}

// ---------------------------------------------------------------- pieces

function BeforeLock() {
  return (
    <div className="stack">
      <h1>Consensus</h1>
      <div className={`card stack ${styles.teaser}`}>
        <p className={styles.teaserTitle}>
          <span aria-hidden>🔒 </span>
          Le consensus sera visible au premier match, {lockLabel(lockAt())}.
        </p>
        <p className="muted">
          D’ici là, les pronos de chacun sont dans ton récap. Ensuite, tu verras ici
          la médiane du groupe pour chaque équipe, les réponses les plus populaires et tous les hot takes, comparés aux
          bookmakers et à la réalité.
        </p>
        <div className="row">
          <Link href="/regles" className="btn btn-primary">
            Lire les règles
          </Link>
        </div>
      </div>
    </div>
  )
}

function Legend({ projLabel, hasProj }: { projLabel: string; hasProj: boolean }) {
  return (
    <ul className={styles.legend} aria-label="Légende du graphique">
      <li>
        <span className={styles.lgRange} aria-hidden /> Fourchette du groupe
      </li>
      <li>
        <span className={styles.lgGroup} aria-hidden /> Médiane du groupe
      </li>
      <li>
        <span className={styles.lgLine} aria-hidden /> Vegas
      </li>
      {hasProj && (
        <li>
          <span className={styles.lgProj} aria-hidden /> {projLabel === 'Final' ? 'Bilan final' : 'Projection'}
        </li>
      )}
    </ul>
  )
}

function TeamLine({
  row,
  rank,
  scale,
  projLabel,
}: {
  row: TeamRow
  rank: number
  scale: { lo: number; hi: number }
  projLabel: string
}) {
  const pos = (v: number) => `${(Math.min(Math.max(v, scale.lo), scale.hi) - scale.lo) / (scale.hi - scale.lo) * 100}%`
  const disagree = row.gap !== null && Math.abs(row.gap) >= DISAGREE_GAP
  const s = row.standing
  return (
    <li className={`${styles.team} ${disagree ? styles.disagree : ''}`}>
      <div className={styles.teamName}>
        <span className={`${styles.rank} tabular`}>{rank}</span>
        <img src={row.team.logo} alt="" className="team-logo" width={28} height={28} loading="lazy" />
        <span className={styles.name}>{row.team.shortName}</span>
        {disagree && (
          <span className={`badge ${styles.gapBadge}`}>
            <span aria-hidden>{(row.gap ?? 0) > 0 ? '▲' : '▼'}</span>
            {fmtSigned.format(row.gap ?? 0)}
            <span className={styles.vs}> vs Vegas</span>
          </span>
        )}
      </div>

      <div className={styles.stat}>
        <span className={styles.statLabel}>Groupe</span>
        <span className={styles.statValue}>
          {row.median === null ? '—' : fmt1.format(row.median)}
          {row.min !== null && row.max !== null && (
            <span className={styles.statSub}>
              {' '}
              <span className="visually-hidden">de </span>
              {row.min}
              <span aria-hidden>–</span>
              <span className="visually-hidden"> à </span>
              {row.max}
            </span>
          )}
        </span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Vegas</span>
        <span className={styles.statValue}>{fmt1.format(row.line)}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>{projLabel}</span>
        <span className={styles.statValue}>
          {row.actual === null ? '—' : row.actual}
          {s && s.w + s.l > 0 && (
            <span className={styles.statSub}>
              {' '}
              ({s.w}-{s.l})
            </span>
          )}
        </span>
      </div>

      <div className={styles.track} aria-hidden>
        {row.min !== null && row.max !== null && (
          <span
            className={styles.range}
            style={{ left: pos(row.min), width: `calc(${pos(row.max)} - ${pos(row.min)})` }}
          />
        )}
        <span className={styles.mLine} style={{ left: pos(row.line) }} />
        {row.actual !== null && <span className={styles.mProj} style={{ left: pos(row.actual) }} />}
        {row.median !== null && <span className={styles.mGroup} style={{ left: pos(row.median) }} />}
      </div>
    </li>
  )
}

function QuestionCard({ stat, groupSize }: { stat: QuestionStat; groupSize: number }) {
  const { q, top, favourite, result, winners, found } = stat
  const finalResult = result?.status === 'final'
  return (
    <article className={`card ${styles.question}`} aria-labelledby={`q-${q.id}`}>
      <div className={styles.qHead}>
        <h3 id={`q-${q.id}`} className={styles.qTitle}>
          {q.label}
        </h3>
        <span className={`badge ${styles.points}`}>{q.points} pts</span>
      </div>

      {top.length === 0 ? (
        <p className="small muted">Personne n’a répondu.</p>
      ) : (
        <ol className={styles.picks}>
          {top.map((t) => (
            <li key={t.id} className={styles.pick}>
              <div className={styles.pickLine}>
                <span className={styles.pickName}>
                  {t.correct && (
                    <span className={styles.check} aria-label="Bonne réponse">
                      ✓{' '}
                    </span>
                  )}
                  {answerLabel(q.kind, t.id)}
                </span>
                <span className={`${styles.pickPct} tabular`}>{pct(t.share)}</span>
              </div>
              <div className={styles.bar} aria-hidden>
                <span style={{ width: `${Math.round(t.share * 100)}%` }} />
              </div>
              <span className="small muted">
                {t.count} joueur{t.count > 1 ? 's' : ''}
                {t.odds !== null && ` · ${pct(t.odds)} selon les bookmakers`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {stat.others > 0 && (
        <p className="small muted">
          + {stat.others} autre{stat.others > 1 ? 's' : ''} choix · {stat.answered}/{groupSize} réponses
        </p>
      )}

      <p className="small">
        <span className="muted">Favori des bookmakers : </span>
        {favourite ? (
          <>
            <strong>{answerLabel(q.kind, favourite.id)}</strong> ({pct(favourite.p)}), choisi par {pct(favourite.groupShare)}{' '}
            du groupe
          </>
        ) : (
          <span className="muted">pas de cote pour cette question</span>
        )}
      </p>

      {finalResult ? (
        <p className="notice notice-ok">
          Résultat : <strong>{winners.map((w) => answerLabel(q.kind, w)).join(' et ')}</strong>
          {groupSize > 0 && ` · ${found === 0 ? 'personne ne l’avait' : `${found} joueur${found > 1 ? 's l’avaient' : ' l’avait'}`}`}
        </p>
      ) : result?.status === 'void' ? (
        <p className="notice notice-warn">Question annulée pour tout le monde (trophée non décerné).</p>
      ) : (
        <p className="small muted">Résultat attendu : {q.resolvesAt}</p>
      )}
    </article>
  )
}
