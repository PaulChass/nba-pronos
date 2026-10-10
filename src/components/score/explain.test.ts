import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { QuestionScore, ScoreCard, TeamScore } from '../../lib/types.ts'
import {
  hotTakesBreakdown,
  projectionExplain,
  questionHotTakeView,
  questionStatus,
  rankPtsExplain,
  teamHotTakeView,
  teamStatus,
  winPtsExplain,
} from './explain.ts'
import { ordinal, pct, rankRangeLabel, signed } from './format.ts'
import { parseView, viewRows } from './views.ts'

const team = (over: Partial<TeamScore> = {}): TeamScore => ({
  abbr: 'SAS',
  conference: 'W',
  predictedWins: 70,
  predictedRank: 1,
  actualWins: 62,
  actualRank: [1, 1],
  line: 58.7,
  winPts: 12,
  rankPts: 5,
  hotTake: null,
  ...over,
})

const question = (over: Partial<QuestionScore> = {}): QuestionScore => ({
  id: 'mvp',
  pick: '123',
  status: 'pending',
  correct: null,
  points: 0,
  maxPoints: 20,
  hotTake: null,
  ...over,
})

const card = (over: Partial<ScoreCard>): ScoreCard => ({
  userId: 1,
  pseudo: 'a',
  gridValid: true,
  lastSavedAt: '2026-10-15T10:00:00Z',
  grid: 0,
  questions: 0,
  hotTakes: 0,
  total: 0,
  teams: [],
  qs: [],
  stillPlayable: 0,
  rank: 1,
  ...over,
})

describe('format', () => {
  it('ordinals and rank ranges', () => {
    assert.equal(ordinal(1), '1er')
    assert.equal(ordinal(4), '4e')
    assert.equal(rankRangeLabel([3, 3]), '3e')
    assert.equal(rankRangeLabel([1, 2]), '1er–2e')
  })
  it('signed numbers use a real minus sign', () => {
    assert.equal(signed(11.3), '+11')
    assert.equal(signed(-4), '−4')
    assert.equal(signed(0.2), '0')
  })
  it('percentages', () => {
    assert.equal(pct(0.123), '12 %')
    assert.equal(pct(0.001), '< 1 %')
  })
})

describe('grid explanations', () => {
  it('win and rank points', () => {
    assert.equal(winPtsExplain(team({ predictedWins: 50, actualWins: 46, winPts: 16 })), '20 − |50 − 46| = 16')
    assert.match(winPtsExplain(team({ predictedWins: 60, actualWins: 30, winPts: 0 })), /négatif, donc 0$/)
    assert.equal(
      rankPtsExplain(team({ predictedRank: 4, actualRank: [3, 4], rankPts: 5 }), false),
      'prono 4e, projection 3e–4e : exact, +5 (bilans identiques : bénéfice du doute)',
    )
    assert.equal(rankPtsExplain(team({ predictedRank: 5, actualRank: [4, 4], rankPts: 2 }), true), 'prono 5e, classement final 4e : à une place près, +2')
  })
  it('status chips only while the season runs', () => {
    assert.equal(teamStatus(team({ winPts: 15 }), false)?.label, 'en bonne voie')
    assert.equal(teamStatus(team({ winPts: 5 }), false)?.label, 'en danger')
    assert.equal(teamStatus(team({ winPts: 10 }), false), null)
    assert.equal(teamStatus(team({ winPts: 18 }), true), null)
  })
  it('projection formula is shown only when it matches the engine', () => {
    // 10-5, line 50: round(10 + 67 * (10 + 25*50/82) / (15 + 25)) = round(52.29) = 52
    const lines = projectionExplain({ w: 10, l: 5 }, 50, 52, false)
    assert.equal(lines.length, 2)
    assert.equal(lines[1], 'arrondi(10 + 67 × (10 + 25 × 50 / 82) / (15 + 25)) = 52 V')
    assert.equal(projectionExplain({ w: 10, l: 5 }, 50, 53, false)[1], 'Projection : 53 V.')
    assert.match(projectionExplain({ w: 0, l: 0 }, 50.8, 51, false)[0], /ligne Vegas \(50,8 V\)/)
  })
})

describe('team hot takes', () => {
  it('caption from the template', () => {
    const v = teamHotTakeView(team({ hotTake: { eligible: true, success: true, bonus: 10 } }), 'Spurs', 58, false)
    assert.equal(v?.caption, 'Spurs à 70 V : +11 sur Vegas, +12 sur le groupe')
    assert.equal(v?.chip.label, 'en cours')
  })
  it('states', () => {
    const notRetained = teamHotTakeView(team({ hotTake: { eligible: false, success: false, bonus: 0 } }), 'Spurs', 66, true)
    assert.equal(notRetained?.chip.label, 'non retenu (le groupe pensait comme toi)')
    const won = teamHotTakeView(team({ hotTake: { eligible: true, success: true, bonus: 10 } }), 'Spurs', 58, true)
    assert.equal(won?.chip.label, 'réussi +10')
    const lost = teamHotTakeView(team({ hotTake: { eligible: true, success: false, bonus: 0 } }), 'Spurs', null, true)
    assert.equal(lost?.chip.label, 'raté')
    assert.equal(lost?.caption, 'Spurs à 70 V : +11 sur Vegas')
    assert.match(lost!.detail, /pas de test du groupe/)
    assert.equal(teamHotTakeView(team(), 'Spurs', 58, true), null)
  })
})

describe('questions', () => {
  it('status', () => {
    assert.equal(questionStatus(question()).label, 'en attente')
    assert.equal(questionStatus(question({ pick: null })).label, 'pas de réponse')
    assert.equal(questionStatus(question({ status: 'void' })).label, 'annulée')
    assert.equal(questionStatus(question({ status: 'final', correct: true, points: 20 })).label, 'bonne réponse')
    assert.equal(questionStatus(question({ status: 'final', correct: false })).label, 'raté')
  })
  it('hot take caption and states', () => {
    const market = { '123': 0.08, '999': 0.32 }
    const pending = questionHotTakeView(question({ hotTake: { eligible: true, success: false, bonus: 0 } }), 'Wemby', market, 1)
    assert.equal(pending?.caption, 'Wemby : 8 % selon les bookmakers (favori à 32 %), choisi par personne d’autre')
    assert.equal(pending?.chip.label, 'en cours')
    const won = questionHotTakeView(
      question({ status: 'final', correct: true, points: 20, hotTake: { eligible: true, success: true, bonus: 20 } }),
      'Wemby',
      market,
      2,
    )
    assert.equal(won?.chip.label, 'réussi +20')
    assert.match(won!.caption, /choisi aussi par 1 autre joueur$/)
    const tooLikely = questionHotTakeView(
      question({ hotTake: { eligible: false, success: false, bonus: 0 } }),
      'Wemby',
      { '123': 0.3, '999': 0.32 },
      1,
    )
    assert.equal(tooLikely?.chip.label, 'non retenu (les bookmakers y croyaient trop)')
    const noMarket = questionHotTakeView(question({ hotTake: { eligible: false, success: false, bonus: 0 } }), 'X', undefined, 3)
    assert.equal(noMarket?.chip.label, 'non retenu (le groupe pensait comme toi)')
  })
  it('hot-take breakdown', () => {
    const c = card({
      teams: [team({ hotTake: { eligible: true, success: true, bonus: 10 } }), team()],
      qs: [question({ hotTake: { eligible: false, success: false, bonus: 0 } })],
    })
    assert.deepEqual(hotTakesBreakdown(c), { declared: 2, eligible: 1, winning: 1 })
  })
})

describe('leaderboard views', () => {
  const cards = [
    card({ userId: 2, pseudo: 'b', rank: 2, total: 400, grid: 380, questions: 20 }),
    card({ userId: 1, pseudo: 'a', rank: 1, total: 410, grid: 370, questions: 40 }),
    card({ userId: 3, pseudo: 'c', rank: 3, total: 390, grid: 380, questions: 10 }),
  ]
  it('parses ?vue=', () => {
    assert.equal(parseView('grille'), 'grille')
    assert.equal(parseView(['hot-takes']), 'hot-takes')
    assert.equal(parseView('nope'), 'general')
    assert.equal(parseView(undefined), 'general')
  })
  it('general keeps the engine order', () => {
    assert.deepEqual(viewRows(cards, 'general').map((r) => [r.card.pseudo, r.rank]), [['a', 1], ['b', 2], ['c', 3]])
  })
  it('sub-rankings share ranks on equal points, in general order', () => {
    const rows = viewRows(cards, 'grille')
    assert.deepEqual(rows.map((r) => [r.card.pseudo, r.points, r.rank, r.tied]), [
      ['b', 380, 1, true],
      ['c', 380, 1, true],
      ['a', 370, 3, false],
    ])
  })
})
