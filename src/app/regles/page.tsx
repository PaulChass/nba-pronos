// The rules, rendered from the barème constants (config/*) and the engine's own helpers
// (lib/scoring), so what players read and how they are scored cannot drift apart.
// Every worked example below is computed by the engine, not typed by hand.
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatLockDate } from '@/components/Countdown'
import { BOOKMAKER_LINES, BOOKMAKER_SOURCE, NORMALIZED_LINES } from '@/config/bookmaker-lines'
import { QUESTION_BY_ID, QUESTIONS, QUESTIONS_MAX_POINTS } from '@/config/questions'
import { SCORING } from '@/config/scoring'
import { isLocked, lockAt, SEASON } from '@/config/season'
import { TEAMS } from '@/data/teams'
import {
  GRID_MAX_POINTS,
  HOT_TAKES_MAX_POINTS,
  projectWins,
  questionHotTakeEligible,
  teamHotTakeCaption,
  teamHotTakeOutcome,
  teamPoints,
  type LockContext,
} from '@/lib/scoring'
import type { Conf, Team } from '@/lib/types'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'Règles',
  description: `Le barème des Pronos NBA ${SEASON.label} : grille, questions, hot takes, projection en direct et classements.`,
}

// ---------------------------------------------------------------- formatting

const int = (n: number) => n.toLocaleString('fr-FR')
const dec = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const dec1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pts = (n: number) => `${int(n)} pt${Math.abs(n) > 1 ? 's' : ''}`
const ordinal = (n: number) => (n === 1 ? '1er' : `${n}e`)
const pct = (p: number) => `${Math.round(p * 100)} %`
const day = (isoDate: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(`${isoDate}T12:00:00Z`))

// ---------------------------------------------------------------- derived numbers

const TEAM_MAX = SCORING.winBase + SCORING.rankExact
const RAW_SUM = Object.values(BOOKMAKER_LINES).reduce((a, b) => a + b, 0)
const factor3 = (SEASON.totalWins / RAW_SUM).toLocaleString('fr-FR', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})
const CHAMPION = QUESTION_BY_ID.champion
const NO_MARKET = QUESTIONS.filter((q) => !q.futuresMarket).map((q) => q.short)
const shareCap = (n: number) => Math.floor((n - 1) / SCORING.htGroupShareDivisor)

// Grid example: 50 predicted, 46 actual; ranked 2nd, finishes 3rd.
const GRID_EX = { P: 50, A: 46, r: 2, range: [3, 3] as [number, number] }
const gridEx = teamPoints(GRID_EX.P, GRID_EX.r, GRID_EX.A, GRID_EX.range)
// Tie example: two teams at 46 wins share ranks 5-6.
const tieEx = teamPoints(46, 6, 46, [5, 6])

// Team hot take example, built around the real Spurs line so it stays true if the line moves.
const HT_TEAM = TEAMS.find((t) => t.abbr === 'SAS') as Team
const htL = NORMALIZED_LINES[HT_TEAM.abbr]
const htP = Math.round(htL) + SCORING.htTeamMinGap + 1
const htM = htP - SCORING.htTeamMinGap
const htA = htP - 4
const htTeamEx = teamHotTakeOutcome(htP, htL, htM, htA)

// Question hot take example: an MVP long shot, 11 players answered, nobody else picked it.
const HT_Q = QUESTION_BY_ID.mvp
const htFav = 0.3
const htPick = Math.round((htFav / (SCORING.htOddsRatio * 1.25)) * 100) / 100
const htN = 11
const htQCtx: LockContext = {
  nGridPlayers: htN,
  medianOthers: {},
  pickCounts: { [HT_Q.id]: { pick: 1 } },
  answeredCounts: { [HT_Q.id]: htN },
  odds: { [HT_Q.id]: { fav: htFav, pick: htPick } },
}
const htQEligible = questionHotTakeEligible(HT_Q.id, 'pick', htQCtx)

// Projection example: a team with a big line that starts 3-0, then only plays at a 60 % pace.
const PROJ_LINE = NORMALIZED_LINES.OKC
const PROJ_ROWS: [number, number][] = [
  [0, 0],
  [3, 0],
  [12, 8],
  [25, 16],
  [37, 25],
  [49, 33],
]

function linesByConf(conf: Conf) {
  return TEAMS.filter((t) => t.conference === conf).sort(
    (a, b) => BOOKMAKER_LINES[b.abbr] - BOOKMAKER_LINES[a.abbr] || a.shortName.localeCompare(b.shortName, 'fr'),
  )
}

// ---------------------------------------------------------------- page

export default function RulesPage() {
  const locked = isLocked()
  const lockDate = formatLockDate(lockAt().toISOString())

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Barème {SCORING.rulesVersion}</p>
        <h1>Les règles</h1>
        <p className={styles.lead}>
          Trois façons de marquer : ta grille, tes réponses aux questions et tes hot takes 🔥. Pas d’argent, pas de
          piège, juste des formules.
        </p>
        <ul className={styles.totals} aria-label="Points maximum">
          <li>
            <a href="#grille" className={styles.total}>
              <span className={styles.totalNum}>{int(GRID_MAX_POINTS)}</span>
              <span className={styles.totalLabel}>Grille</span>
            </a>
          </li>
          <li>
            <a href="#questions" className={styles.total}>
              <span className={styles.totalNum}>{int(QUESTIONS_MAX_POINTS)}</span>
              <span className={styles.totalLabel}>Questions</span>
            </a>
          </li>
          <li>
            <a href="#hot-takes" className={`${styles.total} ${styles.totalFire}`}>
              <span className={styles.totalNum}>+{int(HOT_TAKES_MAX_POINTS)}</span>
              <span className={styles.totalLabel}>Hot takes max</span>
            </a>
          </li>
        </ul>
      </header>

      <div className="stack">
        <p className={`notice ${locked ? 'notice-ok' : 'notice-warn'}`} role="note">
          <span aria-hidden="true">🔒 </span>
          {locked ? (
            <>
              Les pronos sont verrouillés depuis le premier match, le <strong>{lockDate}</strong> (heure de Paris).
              Ils sont maintenant publics.
            </>
          ) : (
            <>
              Verrouillage le <strong>{lockDate}</strong> (heure de Paris), au coup d’envoi du premier match. Jusque-là,
              tu peux tout modifier. Ensuite, plus rien ne bouge et les pronos de tout le monde deviennent publics.
            </>
          )}
        </p>
        <div className={`card ${styles.noAi}`}>
          <span className={styles.noAiIcon} aria-hidden="true">
            🧮
          </span>
          <p>
            <strong>Pas d’IA.</strong> Les points sont calculés uniquement par les formules de cette page, les mêmes
            pour tout le monde. Chaque point est détaillé sur la page de chaque joueur.
          </p>
        </div>
      </div>

      <nav aria-label="Sommaire des règles" className={styles.toc}>
        <a href="#grille">Grille</a>
        <a href="#questions">Questions</a>
        <a href="#hot-takes">Hot takes 🔥</a>
        <a href="#direct">En direct</a>
        <a href="#classements">Classements</a>
        <a href="#lignes">Lignes Vegas</a>
      </nav>

      {/* ------------------------------------------------------------ grille */}
      <section id="grille" aria-labelledby="grille-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="grille-title">La grille</h2>
          <span className="badge">{int(GRID_MAX_POINTS)} pts max</span>
        </div>
        <p>Pour chacune des {TEAMS.length} équipes, deux bonus s’additionnent :</p>
        <ul className={styles.rules}>
          <li>
            <strong>Victoires :</strong> {SCORING.winBase} points moins ton écart avec son vrai nombre de victoires
            (jamais en dessous de 0).
          </li>
          <li>
            <strong>Rang dans sa conférence :</strong> +{SCORING.rankExact} si c’est le bon, +{SCORING.rankNear} à une
            place près.
          </li>
        </ul>
        <p>
          Soit {pts(TEAM_MAX)} max par équipe, et {int(GRID_MAX_POINTS)} pour la grille entière.
        </p>

        <Example>
          <p>
            Tu classes une équipe {ordinal(GRID_EX.r)} de sa conférence avec {GRID_EX.P} victoires. Elle en gagne{' '}
            {GRID_EX.A} et finit {ordinal(GRID_EX.range[0])}.
          </p>
          <dl className={styles.calc}>
            <div>
              <dt>Victoires</dt>
              <dd>
                {SCORING.winBase} − |{GRID_EX.P} − {GRID_EX.A}| = <strong>{pts(gridEx.winPts)}</strong>
              </dd>
            </div>
            <div>
              <dt>Rang</dt>
              <dd>
                {ordinal(GRID_EX.r)} au lieu de {ordinal(GRID_EX.range[0])} : <strong>+{gridEx.rankPts}</strong>
              </dd>
            </div>
            <div className={styles.calcTotal}>
              <dt>Total</dt>
              <dd>
                <strong>{pts(gridEx.winPts + gridEx.rankPts)}</strong>
              </dd>
            </div>
          </dl>
        </Example>

        <h3>Bilans identiques : bénéfice du doute</h3>
        <p>
          Quand plusieurs équipes finissent avec le même bilan, elles partagent les mêmes rangs, et n’importe lequel
          compte comme exact. Deux équipes à 46-36 qui se partagent les places 5 et 6 : que tu en aies mise une 5e ou
          6e, c’est +{tieEx.rankPts}. On ignore les critères de départage de la NBA, et on prend le classement de la
          saison régulière, pas celui d’après le play-in.
        </p>

        <p className="notice notice-warn">
          Ta grille ne rapporte des points que si elle est <strong>complète et valide</strong> au verrouillage : les{' '}
          {TEAMS.length} équipes remplies, exactement {int(SEASON.totalWins)} victoires au total, et jamais plus de
          victoires qu’une équipe que tu as classée au-dessus.
        </p>
      </section>

      {/* ------------------------------------------------------------ questions */}
      <section id="questions" aria-labelledby="questions-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="questions-title">Les questions</h2>
          <span className="badge">{int(QUESTIONS_MAX_POINTS)} pts max</span>
        </div>
        <p>
          {QUESTIONS.length} questions. Une bonne réponse rapporte les points du tableau ; une mauvaise réponse ou une
          case vide, 0. Ton champion doit être l’un de tes deux finalistes, et il rapporte {pts(CHAMPION.points)}.
        </p>

        <div className={styles.tableWrap}>
          <table className={`table ${styles.qTable}`}>
            <caption className="visually-hidden">Les {QUESTIONS.length} questions, leurs points et quand on connaît la réponse</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">Question</th>
                <th scope="col" className="num">
                  Pts
                </th>
                <th scope="col">Réponse</th>
              </tr>
            </thead>
            <tbody>
              {QUESTIONS.map((q, i) => (
                <tr key={q.id}>
                  <td className={`num muted ${styles.qNum}`}>{i + 1}</td>
                  <td>{q.label}</td>
                  <td className="num">
                    <strong>{q.points}</strong>
                  </td>
                  <td className={`muted ${styles.when}`}>{q.resolvesAt}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  Total
                </th>
                <td className="num">
                  <strong>{int(QUESTIONS_MAX_POINTS)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <ul className={styles.rules}>
          <li>
            <strong>Trophée partagé :</strong> chaque co-vainqueur rapporte les points.
          </li>
          <li>
            <strong>Trophée non décerné :</strong> la question est annulée pour tout le monde.
          </li>
          <li>
            <strong>Joueur transféré :</strong> ta réponse reste valable, elle suit le joueur.
          </li>
          <li>
            Les points tombent au fil des résultats officiels : NBA Cup en décembre, meilleur marqueur en avril,
            trophées d’avril à mai, Finales en juin.
          </li>
        </ul>

        <Example>
          <p>
            Tu prends Boston finaliste de l’Est, OKC finaliste de l’Ouest, et Boston champion. OKC bat Boston en
            Finale :
          </p>
          <dl className={styles.calc}>
            <div>
              <dt>{QUESTION_BY_ID.finalistE.short}</dt>
              <dd>
                <strong>+{QUESTION_BY_ID.finalistE.points}</strong>
              </dd>
            </div>
            <div>
              <dt>{QUESTION_BY_ID.finalistW.short}</dt>
              <dd>
                <strong>+{QUESTION_BY_ID.finalistW.points}</strong>
              </dd>
            </div>
            <div>
              <dt>{CHAMPION.short}</dt>
              <dd>0</dd>
            </div>
            <div className={styles.calcTotal}>
              <dt>Total</dt>
              <dd>
                <strong>{pts(QUESTION_BY_ID.finalistE.points + QUESTION_BY_ID.finalistW.points)}</strong>
              </dd>
            </div>
          </dl>
        </Example>
      </section>

      {/* ------------------------------------------------------------ hot takes */}
      <section id="hot-takes" aria-labelledby="hot-takes-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="hot-takes-title">
            Les hot takes <span aria-hidden="true">🔥</span>
          </h2>
          <span className="badge badge-fire">jusqu’à +{HOT_TAKES_MAX_POINTS}</span>
        </div>
        <p>
          Avant le verrouillage, désigne jusqu’à <strong>{SCORING.htMaxTeams} équipes</strong> et{' '}
          <strong>{SCORING.htMaxQuestions} questions</strong> sur lesquelles tu penses avoir raison contre tout le
          monde. C’est un bonus, en plus de tes points normaux.
        </p>

        <div className={`card ${styles.htCard}`}>
          <div className={styles.head}>
            <h3>Sur une équipe</h3>
            <span className="badge badge-fire">+{SCORING.htTeamBonus} pts</span>
          </div>
          <p className={styles.htStep}>Retenu si ton chiffre est :</p>
          <ol className={styles.rules}>
            <li>
              à au moins <strong>{SCORING.htTeamMinGap} victoires</strong> de la{' '}
              <a href="#lignes">ligne des bookmakers</a> ;
            </li>
            <li>
              <strong>et</strong> à au moins {SCORING.htTeamMinGap} victoires de la <strong>médiane des autres
              joueurs</strong>, du même côté. Ce test n’a lieu que s’il y a au moins {SCORING.htGroupMinOthers} autres
              joueurs avec une grille valide.
            </li>
          </ol>
          <p className={styles.htStep}>
            Réussi si le bilan final est <strong>plus proche de ton chiffre</strong> que de la ligne <strong>et</strong>{' '}
            que de la médiane du groupe.
          </p>
          <Example>
            <p>
              Ligne des {HT_TEAM.shortName} : {dec(htL)}. Tu en annonces {htP}, la médiane des autres est à {htM}.
            </p>
            <p className={styles.caption}>
              <span aria-hidden="true">🔥 </span>
              {teamHotTakeCaption(HT_TEAM.shortName, htP, htL, htM)}
            </p>
            <p>{htTeamEx.eligible ? 'Assez d’écart des deux côtés : hot take retenu.' : 'Pas assez d’écart : non retenu.'}</p>
            <p>
              Ils finissent à {htA} victoires. Écarts : toi {Math.abs(htP - htA)}, Vegas {dec(Math.abs(htL - htA))}, le
              groupe {Math.abs(htM - htA)}.{' '}
              {htTeamEx.success ? (
                <strong>Réussi : +{htTeamEx.bonus} pts</strong>
              ) : (
                <strong>Raté, mais ça ne coûte rien.</strong>
              )}
            </p>
          </Example>
        </div>

        <div className={`card ${styles.htCard}`}>
          <div className={styles.head}>
            <h3>Sur une question</h3>
            <span className="badge badge-fire">points doublés</span>
          </div>
          <p className={styles.htStep}>Retenu si :</p>
          <ol className={styles.rules}>
            <li>
              ton choix est au moins <strong>{SCORING.htOddsRatio} fois moins probable que le favori</strong>, d’après
              les cotes des bookmakers relevées au verrouillage (marge du bookmaker retirée). Un choix absent des cotes
              compte comme le moins probable de la liste ;
            </li>
            <li>
              <strong>et</strong> au plus 1 autre joueur sur {SCORING.htGroupShareDivisor} a fait le même choix. À{' '}
              {htN} joueurs, {shareCap(htN)} autres maximum ; à {SCORING.htGroupShareDivisor + 1},{' '}
              {shareCap(SCORING.htGroupShareDivisor + 1)} seul ; à {SCORING.htGroupShareDivisor} ou moins, personne.
            </li>
          </ol>
          <p className={styles.htStep}>
            Questions sans cote ({NO_MARKET.join(', ')}) : il faut que <strong>personne d’autre</strong> n’ait fait ce
            choix, et qu’au moins {SCORING.htGroupMinOthers} autres joueurs aient répondu.
          </p>
          <p className={styles.htStep}>
            Réussi si ta réponse est la bonne : <strong>les points de la question sont doublés</strong>.
          </p>
          <Example>
            <p>
              Pour le {HT_Q.short}, le favori est à {pct(htFav)} et ton joueur à {pct(htPick)} :{' '}
              {(htFav / htPick).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} fois moins probable. Vous êtes {htN} à répondre et personne n’a pris le même.{' '}
              {htQEligible ? 'Hot take retenu.' : 'Non retenu.'}
            </p>
            <p>
              {htQEligible ? (
                <>
                  S’il est élu : {HT_Q.points} + {HT_Q.points} = <strong>{pts(2 * HT_Q.points)}</strong>.
                </>
              ) : (
                <>S’il est élu : {pts(HT_Q.points)}.</>
              )}
            </p>
          </Example>
        </div>

        <ul className={styles.rules}>
          <li>Un hot take non retenu (« le groupe pensait comme toi ») ou raté ne te retire aucun point.</li>
          <li>
            Mais pour être retenu, tu dois t’éloigner du scénario le plus probable, ce qui coûte souvent des points de
            grille ou de questions : <strong>ce n’est jamais gratuit</strong>.
          </li>
          <li>
            Avant le verrouillage, l’appli ne te laisse cocher 🔥 que si l’écart avec les bookmakers est déjà là. L’avis
            du groupe, lui, est vérifié au verrouillage.
          </li>
          <li>
            Pendant la saison, les hot takes équipes sont évalués sur la <a href="#direct">projection</a>, puis
            définitivement à la fin de la saison régulière.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------------------ direct */}
      <section id="direct" aria-labelledby="direct-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="direct-title">En direct</h2>
        </div>
        <p>
          Pas besoin d’attendre avril : chaque nuit, ta grille est comparée à une <strong>projection</strong> du bilan
          final de chaque équipe, pas à son bilan brut.
        </p>
        <p>
          La projection part du bilan actuel et complète les matchs restants avec un mélange du rythme de l’équipe et
          de la ligne des bookmakers. En début de saison, elle colle à la ligne. Plus les matchs passent, plus le vrai
          rythme compte. Après {SEASON.gamesPerTeam} matchs, c’est le vrai bilan. Un départ à 3-0 ne bouleverse donc
          pas le classement.
        </p>

        <Example>
          <p>
            Une équipe avec une ligne à {dec(PROJ_LINE)} part sur un 3-0, puis ne gagne finalement que 60 % de ses
            matchs :
          </p>
          <div className={styles.tableWrap}>
            <table className={`table ${styles.projTable}`}>
              <caption className="visually-hidden">Projection selon le nombre de matchs joués</caption>
              <thead>
                <tr>
                  <th scope="col">Matchs joués</th>
                  <th scope="col" className="num">
                    Bilan
                  </th>
                  <th scope="col" className="num">
                    Projection
                  </th>
                </tr>
              </thead>
              <tbody>
                {PROJ_ROWS.map(([w, l]) => (
                  <tr key={`${w}-${l}`}>
                    <td>
                      {w + l}
                      {w + l >= SEASON.gamesPerTeam && <span className="muted small"> (fin)</span>}
                    </td>
                    <td className="num">
                      {w}-{l}
                    </td>
                    <td className="num">
                      <strong>{projectWins({ abbr: 'OKC', conference: 'W', w, l }, PROJ_LINE)} V</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Example>

        <ul className={styles.rules}>
          <li>Les rangs et les hot takes équipes se calculent aussi sur la projection.</li>
          <li>
            La grille devient définitive à la fin de la saison régulière, le {day(SEASON.regularSeasonEnd)}. Le play-in
            ne compte pas.
          </li>
          <li>
            Les questions tombent avec les résultats officiels, à commencer par la NBA Cup le {day(SEASON.cupFinal)}.
          </li>
          <li>
            Le classement affiche aussi tes <strong>points encore jouables</strong> : les questions pas encore
            tranchées auxquelles tu as répondu (doublées si ton hot take est retenu).
          </li>
        </ul>

        <details className={styles.details}>
          <summary>Pour les curieux : la formule</summary>
          <p className={styles.formula}>
            projection = arrondi( V + ({SEASON.gamesPerTeam} − MJ) × (V + {SCORING.projectionK} × L ÷{' '}
            {SEASON.gamesPerTeam}) ÷ (MJ + {SCORING.projectionK}) )
          </p>
          <p>
            V = victoires, MJ = matchs joués, L = ligne des bookmakers ramenée sur {int(SEASON.totalWins)} victoires.
            En clair : la ligne compte comme {SCORING.projectionK} matchs déjà joués à son rythme, et son poids s’efface
            à mesure que les vrais matchs s’accumulent.
          </p>
        </details>
      </section>

      {/* ------------------------------------------------------------ classements */}
      <section id="classements" aria-labelledby="classements-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="classements-title">Les classements</h2>
        </div>
        <p>Quatre classements :</p>
        <ul className={styles.boards}>
          <li>
            <strong>Grille</strong>
            <span className="muted small">victoires + rangs</span>
          </li>
          <li>
            <strong>Questions</strong>
            <span className="muted small">points de base</span>
          </li>
          <li>
            <strong>Hot takes 🔥</strong>
            <span className="muted small">tous les bonus</span>
          </li>
          <li className={styles.boardMain}>
            <strong>Général</strong>
            <span className="small">la somme des trois</span>
          </li>
        </ul>
        <p>
          Pas de coefficient ni de normalisation : ton total, c’est ce que tu as marqué, point par point.
        </p>
        <h3>En cas d’égalité</h3>
        <ol className={styles.rules}>
          <li>la meilleure grille passe devant ;</li>
          <li>puis le prono dont la dernière modification est la plus ancienne (premier engagé, premier servi) ;</li>
          <li>puis l’ordre alphabétique des pseudos.</li>
        </ol>
        <Example>
          <p>
            Léa et Max finissent tous les deux à 612 pts. Léa a 405 pts de grille, Max 398 : <strong>Léa passe
            devant</strong>.
          </p>
        </Example>
        {locked && (
          <p>
            <Link href="/classement">Voir le classement →</Link>
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ lignes */}
      <section id="lignes" aria-labelledby="lignes-title" className={styles.section}>
        <div className={styles.head}>
          <h2 id="lignes-title">Les lignes des bookmakers</h2>
        </div>
        <p>
          Les lignes de victoires viennent de {BOOKMAKER_SOURCE}. Elles totalisent {int(RAW_SUM)} victoires, alors
          qu’une saison n’en compte que {int(SEASON.totalWins)} ({TEAMS.length} équipes × {SEASON.gamesPerTeam} matchs
          ÷ 2). On les ramène donc sur {int(SEASON.totalWins)}, en les multipliant toutes par {factor3}. C’est cette{' '}
          <strong>ligne ramenée</strong> qui sert pour les hot takes et la projection.
        </p>
        <details className={styles.details} open={locked}>
          <summary>Voir les lignes Vegas</summary>
          {!locked && (
            <p className="muted small">
              Elles sont masquées par défaut dans la grille pour ne pas influencer ton avis.
            </p>
          )}
          <div className={styles.linesGrid}>
            {(['E', 'W'] as const).map((conf) => (
              <div key={conf} className={styles.tableWrap}>
                <table className={`table ${styles.linesTable}`}>
                  <caption className={styles.linesCaption}>
                    <span className={`badge ${conf === 'E' ? 'badge-east' : 'badge-west'}`}>
                      {conf === 'E' ? 'Conférence Est' : 'Conférence Ouest'}
                    </span>
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Équipe</th>
                      <th scope="col" className="num">
                        Ligne
                      </th>
                      <th scope="col" className="num">
                        Ramenée
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {linesByConf(conf).map((t) => (
                      <tr key={t.abbr}>
                        <th scope="row" className={styles.teamTh}>
                          <span className={styles.teamCell}>
                            <img src={t.logo} alt="" className="team-logo" width={28} height={28} loading="lazy" />
                            {t.shortName}
                          </span>
                        </th>
                        <td className="num muted">{dec1(BOOKMAKER_LINES[t.abbr])}</td>
                        <td className="num">
                          <strong>{dec1(NORMALIZED_LINES[t.abbr])}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </details>
      </section>

      <p className={`muted small ${styles.footer}`}>
        Barème {SCORING.rulesVersion}. Cette page est générée à partir de la configuration du jeu, la même que celle
        qui calcule les points : elle ne peut pas la contredire.
      </p>
    </div>
  )
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.example}>
      <p className={styles.exampleLabel}>Exemple</p>
      {children}
    </div>
  )
}
