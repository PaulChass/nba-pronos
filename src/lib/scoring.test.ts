// node --test src/lib/scoring.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NORMALIZED_LINES } from '../config/bookmaker-lines.ts'
import { QUESTIONS } from '../config/questions.ts'
import { SCORING } from '../config/scoring.ts'
import { SEASON } from '../config/season.ts'
import { TEAMS } from '../data/teams.ts'
import {
  GRID_MAX_POINTS,
  HOT_TAKES_MAX_POINTS,
  actualWins,
  buildLockContext,
  declaredHotTakes,
  leaderboard,
  median,
  projectWins,
  questionHotTakeEligible,
  rankRanges,
  scoreAll,
  scoreUser,
  teamHotTakeCaption,
  teamHotTakeOutcome,
  teamPoints,
} from './scoring.ts'
import type {
  Answers,
  Conf,
  QuestionId,
  QuestionOdds,
  Results,
  ScoreCard,
  StoredPrediction,
  TeamAbbr,
  TeamStanding,
} from './types.ts'
import { gridStatus } from './validation.ts'

// ---------------------------------------------------------------- helpers

const CONF_OF: Record<TeamAbbr, Conf> = Object.fromEntries(TEAMS.map((t) => [t.abbr, t.conference]))
const byConf = (c: Conf) => TEAMS.filter((t) => t.conference === c).map((t) => t.abbr)

/** Largest-remainder rounding of non-negative reals to integers summing to 1230. */
function intTo1230(values: Record<TeamAbbr, number>): Record<TeamAbbr, number> {
  const abbrs = Object.keys(values)
  const sum = abbrs.reduce((s, a) => s + values[a], 0)
  const scaled = abbrs.map((a) => ({ a, x: (values[a] * SEASON.totalWins) / sum }))
  const out: Record<TeamAbbr, number> = Object.fromEntries(scaled.map(({ a, x }) => [a, Math.floor(x)]))
  let rem = SEASON.totalWins - Object.values(out).reduce((s, x) => s + x, 0)
  for (const { a } of [...scaled].sort((p, q) => q.x - Math.floor(q.x) - (p.x - Math.floor(p.x)) || p.a.localeCompare(q.a))) {
    if (rem-- <= 0) break
    out[a]++
  }
  return out
}

/** Drag order from wins: desc, ties broken by `tie` desc, then tricode. */
function orderFrom(wins: Record<TeamAbbr, number>, tie: Record<TeamAbbr, number> = {}): Record<Conf, TeamAbbr[]> {
  const sort = (c: Conf) =>
    byConf(c).sort((a, b) => wins[b] - wins[a] || (tie[b] ?? 0) - (tie[a] ?? 0) || a.localeCompare(b))
  return { E: sort('E'), W: sort('W') }
}

/** Baseline valid grid: the 2026-27 normalized lines rounded to 1230. */
const BASE_WINS = intTo1230(NORMALIZED_LINES)

function pred(
  userId: number,
  overrides: Partial<StoredPrediction> & { wins?: Record<TeamAbbr, number> } = {},
): StoredPrediction {
  const wins = { ...BASE_WINS, ...overrides.wins }
  return {
    userId,
    pseudo: overrides.pseudo ?? `joueur${userId}`,
    gridValid: overrides.gridValid ?? true,
    lastSavedAt: overrides.lastSavedAt ?? '2026-10-15T10:00:00.000Z',
    grid: overrides.grid ?? { order: orderFrom(wins, NORMALIZED_LINES), wins },
    answers: overrides.answers ?? {},
    hotTakes: overrides.hotTakes ?? { teams: [], questions: [] },
  }
}

const emptyCtx = (odds: QuestionOdds = {}) => buildLockContext([], odds)

function card(pseudo: string, total: number, grid: number, lastSavedAt: string): ScoreCard {
  return {
    userId: pseudo.length,
    pseudo,
    gridValid: true,
    lastSavedAt,
    grid,
    questions: total - grid,
    hotTakes: 0,
    total,
    teams: [],
    qs: [],
    stillPlayable: 0,
    rank: 0,
  }
}

// 2025-26 real records (Basketball-Reference / ESPN, regular season).
const RECORDS_2526: Record<TeamAbbr, [number, number]> = {
  DET: [60, 22], BOS: [56, 26], NYK: [53, 29], CLE: [52, 30], TOR: [46, 36],
  ATL: [46, 36], PHI: [45, 37], ORL: [45, 37], CHA: [44, 38], MIA: [43, 39],
  MIL: [32, 50], CHI: [31, 51], BKN: [20, 62], IND: [19, 63], WAS: [17, 65],
  OKC: [64, 18], SAS: [62, 20], DEN: [54, 28], LAL: [53, 29], HOU: [52, 30],
  MIN: [49, 33], PHX: [45, 37], POR: [42, 40], LAC: [42, 40], GSW: [37, 45],
  NOP: [26, 56], DAL: [26, 56], MEM: [25, 57], SAC: [22, 60], UTA: [22, 60],
}
// 2025-26 preseason win totals, DraftKings via SI (2025-10-17). Sum 1226.
const LINES_2526: Record<TeamAbbr, number> = {
  OKC: 62.5, CLE: 56.5, DEN: 54.5, HOU: 53.5, NYK: 53.5, ORL: 50.5, MIN: 48.5, LAC: 47.5,
  ATL: 47.5, LAL: 46.5, GSW: 46.5, DET: 46.5, SAS: 44.5, MIL: 43.5, PHI: 42.5, BOS: 41.5,
  MEM: 39.5, DAL: 39.5, TOR: 38.5, IND: 37.5, MIA: 36.5, SAC: 35.5, POR: 34.5, CHI: 32.5,
  PHX: 30.5, NOP: 30.5, CHA: 25.5, WAS: 20.5, BKN: 20.5, UTA: 18.5,
}
const standings2526: TeamStanding[] = Object.entries(RECORDS_2526).map(([abbr, [w, l]]) => ({
  abbr,
  conference: CONF_OF[abbr],
  w,
  l,
}))
const WINS_2526: Record<TeamAbbr, number> = Object.fromEntries(Object.entries(RECORDS_2526).map(([a, [w]]) => [a, w]))

// ---------------------------------------------------------------- constants

describe('constants', () => {
  it('grid max is 750 and hot takes max 80', () => {
    assert.equal(GRID_MAX_POINTS, 750)
    assert.equal(HOT_TAKES_MAX_POINTS, 3 * 10 + 30 + 20)
  })
  it('median', () => {
    assert.equal(median([]), null)
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([60, 58, 62, 60]), 60)
    assert.equal(median([1, 2, 3, 10]), 2.5)
  })
})

// ---------------------------------------------------------------- projection

describe('projectWins', () => {
  it('equals the (rounded) line at 0 games played', () => {
    assert.equal(projectWins({ abbr: 'OKC', conference: 'W', w: 0, l: 0 }, 61.7), 62)
    assert.equal(projectWins({ abbr: 'SAC', conference: 'W', w: 0, l: 0 }, 21.2), 21)
    for (const t of TEAMS) {
      const L = NORMALIZED_LINES[t.abbr]
      assert.ok(Math.abs(projectWins({ abbr: t.abbr, conference: t.conference, w: 0, l: 0 }, L) - L) <= 0.5)
    }
  })
  it('equals the real total at 82 games, whatever the line', () => {
    assert.equal(projectWins({ abbr: 'DET', conference: 'E', w: 60, l: 22 }, 20), 60)
    assert.equal(projectWins({ abbr: 'WAS', conference: 'E', w: 17, l: 65 }, 60), 17)
  })
  it('blends pace and line mid-season, the line fading as games are played', () => {
    // 8 + 72 * (8 + 25*41/82) / 35 = 50.17
    assert.equal(projectWins({ abbr: 'X', conference: 'E', w: 8, l: 2 }, 41), 50)
    // Same 80% pace, more games: closer to 0.8*82 = 65.6
    assert.equal(projectWins({ abbr: 'X', conference: 'E', w: 40, l: 10 }, 41), 62) // 40 + 32 * 52.5 / 75 = 62.4
    assert.ok(projectWins({ abbr: 'X', conference: 'E', w: 3, l: 0 }, 30) < 40, 'a 3-0 start does not explode')
  })
})

describe('actualWins', () => {
  it('uses real wins when final, projection otherwise, line for missing teams', () => {
    const st: TeamStanding[] = [{ abbr: 'DET', conference: 'E', w: 30, l: 11 }]
    const live = actualWins(st, NORMALIZED_LINES, false)
    assert.equal(live.DET, projectWins(st[0], NORMALIZED_LINES.DET))
    assert.equal(live.OKC, Math.round(NORMALIZED_LINES.OKC))
    assert.equal(Object.keys(live).length, 30)
    assert.equal(actualWins(st, NORMALIZED_LINES, true).DET, 30)
    assert.deepEqual(actualWins(standings2526, NORMALIZED_LINES, true), WINS_2526)
  })
})

// ---------------------------------------------------------------- ranks & team points

describe('rankRanges', () => {
  const r = rankRanges(WINS_2526)
  it('gives unique ranks to distinct records', () => {
    assert.deepEqual(r.DET, [1, 1])
    assert.deepEqual(r.CHA, [9, 9])
    assert.deepEqual(r.WAS, [15, 15])
    assert.deepEqual(r.OKC, [1, 1])
  })
  it('shares a range between tied records, per conference', () => {
    assert.deepEqual(r.TOR, [5, 6])
    assert.deepEqual(r.ATL, [5, 6])
    assert.deepEqual(r.PHI, [7, 8])
    assert.deepEqual(r.ORL, [7, 8])
    // PHX (W) is also 45-37 but is ranked within the West only
    assert.deepEqual(r.PHX, [7, 7])
    assert.deepEqual(r.POR, [8, 9])
    assert.deepEqual(r.LAC, [8, 9])
    assert.deepEqual(r.NOP, [11, 12])
    assert.deepEqual(r.SAC, [14, 15])
    assert.deepEqual(r.UTA, [14, 15])
  })
  it('handles a three-way tie', () => {
    const w = { ...WINS_2526, NYK: 52, BOS: 52 }
    const rr = rankRanges(w)
    assert.deepEqual(rr.BOS, [2, 4])
    assert.deepEqual(rr.CLE, [2, 4])
    assert.deepEqual(rr.DET, [1, 1])
  })
})

describe('teamPoints', () => {
  it('50 predicted vs 46 actual = 16 win points', () => {
    assert.equal(teamPoints(50, 3, 46, [3, 3]).winPts, 16)
  })
  it('never goes below 0 and peaks at 20', () => {
    assert.equal(teamPoints(70, 1, 40, [1, 1]).winPts, 0)
    assert.equal(teamPoints(46, 1, 46, [1, 1]).winPts, SCORING.winBase)
  })
  it('rank: +5 exact (anywhere in a tied range), +2 one place off, else 0', () => {
    assert.equal(teamPoints(46, 3, 46, [3, 3]).rankPts, 5)
    assert.equal(teamPoints(46, 5, 46, [5, 6]).rankPts, 5)
    assert.equal(teamPoints(46, 6, 46, [5, 6]).rankPts, 5)
    assert.equal(teamPoints(46, 4, 46, [5, 6]).rankPts, 2)
    assert.equal(teamPoints(46, 7, 46, [5, 6]).rankPts, 2)
    assert.equal(teamPoints(46, 8, 46, [5, 6]).rankPts, 0)
    assert.equal(teamPoints(46, 3, 46, [5, 6]).rankPts, 0)
  })
})

// ---------------------------------------------------------------- grid through scoreUser

describe('scoreUser — grid', () => {
  it('scores a perfect grid 750', () => {
    const p = pred(1, { wins: WINS_2526, grid: { order: orderFrom(WINS_2526), wins: WINS_2526 } })
    const c = scoreUser(p, emptyCtx(), WINS_2526, {})
    assert.equal(c.grid, 750)
    assert.equal(c.teams.length, 30)
    assert.equal(c.total, 750)
  })
  it('uses the drag order as the predicted rank', () => {
    const p = pred(1)
    const c = scoreUser(p, emptyCtx(), BASE_WINS, {})
    const first = c.teams.find((t) => t.abbr === p.grid.order.W[0])!
    assert.equal(first.predictedRank, 1)
    assert.equal(first.line, NORMALIZED_LINES[first.abbr])
  })
  it('an invalid grid earns 0 grid points but is still listed', () => {
    const p = pred(1, { gridValid: false, hotTakes: { teams: ['SAS'], questions: [] } })
    const c = scoreUser(p, emptyCtx(), BASE_WINS, {})
    assert.equal(c.grid, 0)
    assert.equal(c.teams.length, 30)
    assert.ok(c.teams.every((t) => t.winPts === 0 && t.rankPts === 0))
    assert.deepEqual(c.teams.find((t) => t.abbr === 'SAS')!.hotTake, { eligible: false, success: false, bonus: 0 })
    assert.equal(c.hotTakes, 0)
  })
})

// ---------------------------------------------------------------- team hot takes

describe('team hot takes', () => {
  const L = 58.7
  it('fails the bookmaker test under 10 wins from the line', () => {
    assert.equal(teamHotTakeOutcome(68, L, null, 68).eligible, false) // +9.3
    assert.equal(teamHotTakeOutcome(69, L, null, 69).eligible, true) // +10.3
  })
  it('fails the group test when the median is less than 10 wins away on the same side', () => {
    assert.equal(teamHotTakeOutcome(70, L, 61, 70).eligible, false) // +9 on the group
    assert.equal(teamHotTakeOutcome(70, L, 60, 70).eligible, true) // +10 on the group
    // group on the other side of the line still counts (same direction as the bookmaker gap)
    assert.equal(teamHotTakeOutcome(70, L, 75, 70).eligible, false)
  })
  it('skips the group test with fewer than 4 others (M = null)', () => {
    assert.equal(teamHotTakeOutcome(70, L, null, 70).eligible, true)
  })
  it('over side: success when strictly closer than both line and median', () => {
    assert.deepEqual(teamHotTakeOutcome(70, L, 60, 66), { eligible: true, success: true, bonus: SCORING.htTeamBonus })
    assert.deepEqual(teamHotTakeOutcome(70, L, 60, 60), { eligible: true, success: false, bonus: 0 })
    // equidistant from the median: not strictly closer
    assert.equal(teamHotTakeOutcome(70, L, 60, 65).success, false)
    // M null: only the line matters
    assert.equal(teamHotTakeOutcome(70, L, null, 65).success, true)
  })
  it('under side: success and failure', () => {
    assert.deepEqual(teamHotTakeOutcome(20, 37, 36, 22), { eligible: true, success: true, bonus: 10 })
    assert.equal(teamHotTakeOutcome(20, 37, 36, 40).success, false)
    assert.equal(teamHotTakeOutcome(20, 37, 29, 22).eligible, false) // only 9 under the group
  })
  it('caption uses the fixed template', () => {
    assert.equal(teamHotTakeCaption('Spurs', 70, 58.7, 58), 'Spurs à 70 V : +11 sur Vegas, +12 sur le groupe')
    assert.equal(teamHotTakeCaption('Jazz', 20, 37, null), 'Jazz à 20 V : −17 sur Vegas')
  })
})

describe('buildLockContext + team hot takes end to end', () => {
  // User 1 is bold on SAS (70). Others: 58, 60, 60, 62 -> median 60. User 6 has an invalid grid.
  const users = [
    pred(1, { wins: { SAS: 70 }, hotTakes: { teams: ['SAS'], questions: [] } }),
    pred(2, { wins: { SAS: 58 } }),
    pred(3, { wins: { SAS: 60 } }),
    pred(4, { wins: { SAS: 60 } }),
    pred(5, { wins: { SAS: 62 } }),
    pred(6, { wins: { SAS: 20 }, gridValid: false }),
  ]
  const ctx = buildLockContext(users, {})

  it('medians use the other VALID grids only', () => {
    assert.equal(ctx.nGridPlayers, 5)
    assert.equal(ctx.medianOthers[1].SAS, 60)
    assert.equal(ctx.medianOthers[2].SAS, 61) // 60, 60, 62, 70
    assert.equal(ctx.medianOthers[6].SAS, 60) // 58, 60, 60, 62, 70
  })
  it('success against real wins', () => {
    const c = scoreUser(users[0], ctx, { ...BASE_WINS, SAS: 66 }, {})
    const sas = c.teams.find((t) => t.abbr === 'SAS')!
    assert.deepEqual(sas.hotTake, { eligible: true, success: true, bonus: 10 })
    assert.equal(c.hotTakes, 10)
    assert.equal(c.teams.filter((t) => t.hotTake).length, 1)
  })
  it('failure costs nothing', () => {
    const c = scoreUser(users[0], ctx, { ...BASE_WINS, SAS: 59 }, {})
    assert.deepEqual(c.teams.find((t) => t.abbr === 'SAS')!.hotTake, { eligible: true, success: false, bonus: 0 })
    assert.equal(c.hotTakes, 0)
  })
  it('group test fails when the group thinks alike', () => {
    const bold = users.map((u) => (u.userId === 1 ? u : pred(u.userId, { wins: { SAS: 66 } })))
    const c = scoreUser(bold[0], buildLockContext(bold, {}), { ...BASE_WINS, SAS: 70 }, {})
    assert.equal(c.teams.find((t) => t.abbr === 'SAS')!.hotTake?.eligible, false)
  })
  it('fewer than 4 other valid grids: median null, group test skipped', () => {
    const small = users.slice(0, 4)
    const sctx = buildLockContext(small, {})
    assert.equal(sctx.medianOthers[1].SAS, null)
    const c = scoreUser(small[0], sctx, { ...BASE_WINS, SAS: 66 }, {})
    assert.equal(c.teams.find((t) => t.abbr === 'SAS')!.hotTake?.success, true)
  })
  it('ignores declared teams beyond the cap, in stored order', () => {
    const p = pred(1, { hotTakes: { teams: ['SAS', 'SAS', 'OKC', 'UTA', 'BKN', 'XXX'], questions: [] } })
    assert.deepEqual(declaredHotTakes(p).teams, ['SAS', 'OKC', 'UTA'])
    const c = scoreUser(p, ctx, BASE_WINS, {})
    assert.equal(c.teams.find((t) => t.abbr === 'BKN')!.hotTake, null)
    assert.notEqual(c.teams.find((t) => t.abbr === 'UTA')!.hotTake, null)
  })
})

// ---------------------------------------------------------------- questions

/** Context where `n` players answered `q`, `same` of them (user included) with `pick`. */
function qctx(q: QuestionId, pick: string, n: number, same: number, odds: QuestionOdds = {}) {
  const preds: StoredPrediction[] = []
  for (let i = 1; i <= n; i++) preds.push(pred(i, { answers: { [q]: i <= same ? pick : `other${i}` } as Answers }))
  return buildLockContext(preds, odds)
}

describe('question hot-take eligibility', () => {
  const odds: QuestionOdds = { mvp: { fav: 0.3, mid: 0.12, long: 0.09, longer: 0.05 } }

  it('counts picks and answers at lock', () => {
    const ctx = qctx('mvp', 'long', 11, 3, odds)
    assert.equal(ctx.answeredCounts.mvp, 11)
    assert.equal(ctx.pickCounts.mvp?.long, 3)
  })
  it('bookmaker test: at least 3x less likely than the favourite', () => {
    assert.equal(questionHotTakeEligible('mvp', 'long', qctx('mvp', 'long', 11, 1, odds)), true)
    assert.equal(questionHotTakeEligible('mvp', 'mid', qctx('mvp', 'mid', 11, 1, odds)), false)
    assert.equal(questionHotTakeEligible('mvp', 'fav', qctx('mvp', 'fav', 11, 1, odds)), false)
  })
  it('an unlisted pick counts as the longest listed shot', () => {
    assert.equal(questionHotTakeEligible('mvp', 'nobody', qctx('mvp', 'nobody', 11, 1, odds)), true)
    const flat: QuestionOdds = { mvp: { a: 0.3, b: 0.3, c: 0.4 } }
    assert.equal(questionHotTakeEligible('mvp', 'nobody', qctx('mvp', 'nobody', 11, 1, flat)), false)
  })
  it('group test: at most floor((N-1)/5) others with the same pick', () => {
    assert.equal(questionHotTakeEligible('mvp', 'long', qctx('mvp', 'long', 11, 3, odds)), true) // 2 others <= 2
    assert.equal(questionHotTakeEligible('mvp', 'long', qctx('mvp', 'long', 11, 4, odds)), false) // 3 others
    assert.equal(questionHotTakeEligible('mvp', 'long', qctx('mvp', 'long', 5, 2, odds)), false) // 1 > floor(4/5)
    assert.equal(questionHotTakeEligible('mvp', 'long', qctx('mvp', 'long', 5, 1, odds)), true)
  })
  it('no market: nobody else, and at least 4 others answered', () => {
    assert.equal(questionHotTakeEligible('clutch', 'x', qctx('clutch', 'x', 5, 1)), true)
    assert.equal(questionHotTakeEligible('clutch', 'x', qctx('clutch', 'x', 4, 1)), false)
    assert.equal(questionHotTakeEligible('clutch', 'x', qctx('clutch', 'x', 12, 2)), false)
    // an empty market is no market
    assert.equal(questionHotTakeEligible('mvp', 'x', qctx('mvp', 'x', 5, 1, { mvp: {} })), true)
  })
  it('no pick, no hot take', () => {
    assert.equal(questionHotTakeEligible('mvp', null, qctx('mvp', 'long', 11, 1, odds)), false)
  })
})

describe('scoreUser — questions', () => {
  const answers: Answers = { mvp: 'p1', roy: 'p2', dpoy: 'p3', clutch: 'p4', finalistE: 'NYK', finalistW: 'OKC', champion: 'NYK', coy: 'c1' }

  it('final: base points when the pick is among the winners (co-winners all score)', () => {
    const results: Results = {
      mvp: { status: 'final', winners: ['p1'], source: 'auto' },
      roy: { status: 'final', winners: ['zz'], source: 'auto' },
      dpoy: { status: 'final', winners: ['zz', 'p3'], source: 'admin' },
    }
    const c = scoreUser(pred(1, { answers }), emptyCtx(), BASE_WINS, results)
    const q = (id: QuestionId) => c.qs.find((x) => x.id === id)!
    assert.deepEqual([q('mvp').correct, q('mvp').points], [true, 20])
    assert.deepEqual([q('roy').correct, q('roy').points], [false, 0])
    assert.deepEqual([q('dpoy').correct, q('dpoy').points], [true, 20])
    assert.equal(c.questions, 40)
    assert.equal(c.qs.length, QUESTIONS.length)
  })
  it('champion is worth 30', () => {
    const c = scoreUser(pred(1, { answers }), emptyCtx(), BASE_WINS, {
      champion: { status: 'final', winners: ['NYK'], source: 'auto' },
      finalistE: { status: 'final', winners: ['NYK'], source: 'auto' },
    })
    assert.equal(c.qs.find((x) => x.id === 'champion')!.points, 30)
    assert.equal(c.questions, 50)
  })
  it('void: 0 points and 0 max for everyone; pending: 0 points, full max', () => {
    const c = scoreUser(pred(1, { answers }), emptyCtx(), BASE_WINS, { clutch: { status: 'void' } })
    const clutch = c.qs.find((x) => x.id === 'clutch')!
    assert.deepEqual([clutch.status, clutch.correct, clutch.points, clutch.maxPoints], ['void', null, 0, 0])
    const mvp = c.qs.find((x) => x.id === 'mvp')!
    assert.deepEqual([mvp.status, mvp.correct, mvp.points, mvp.maxPoints], ['pending', null, 0, 20])
  })
  it('unanswered final question: correct null, 0 points', () => {
    const c = scoreUser(pred(1, { answers: {} }), emptyCtx(), BASE_WINS, {
      mvp: { status: 'final', winners: ['p1'], source: 'auto' },
    })
    const mvp = c.qs.find((x) => x.id === 'mvp')!
    assert.deepEqual([mvp.pick, mvp.correct, mvp.points], [null, null, 0])
  })
  it('successful question hot take doubles the points; a miss costs nothing', () => {
    const preds = [
      pred(1, { answers: { clutch: 'rare', champion: 'NYK', finalistE: 'NYK' }, hotTakes: { teams: [], questions: ['clutch', 'champion'] } }),
      ...[2, 3, 4, 5].map((i) => pred(i, { answers: { clutch: `p${i}`, champion: 'OKC', finalistW: 'OKC' } })),
    ]
    const odds: QuestionOdds = { champion: { OKC: 0.45, NYK: 0.1, BOS: 0.08 } }
    const ctx = buildLockContext(preds, odds)
    const won = scoreUser(preds[0], ctx, BASE_WINS, {
      clutch: { status: 'final', winners: ['rare'], source: 'auto' },
      champion: { status: 'final', winners: ['NYK'], source: 'auto' },
    })
    assert.deepEqual(won.qs.find((x) => x.id === 'clutch')!.hotTake, { eligible: true, success: true, bonus: 20 })
    assert.deepEqual(won.qs.find((x) => x.id === 'champion')!.hotTake, { eligible: true, success: true, bonus: 30 })
    assert.equal(won.hotTakes, 50)
    assert.equal(won.questions, 50)
    const lost = scoreUser(preds[0], ctx, BASE_WINS, {
      clutch: { status: 'final', winners: ['p2'], source: 'auto' },
      champion: { status: 'final', winners: ['OKC'], source: 'auto' },
    })
    assert.equal(lost.hotTakes, 0)
    assert.equal(lost.questions, 0)
    assert.deepEqual(lost.qs.find((x) => x.id === 'clutch')!.hotTake, { eligible: true, success: false, bonus: 0 })
  })
  it('a void question voids its hot take', () => {
    const preds = [pred(1, { answers: { clutch: 'rare' }, hotTakes: { teams: [], questions: ['clutch'] } }), ...[2, 3, 4, 5].map((i) => pred(i, { answers: { clutch: `p${i}` } }))]
    const c = scoreUser(preds[0], buildLockContext(preds, {}), BASE_WINS, { clutch: { status: 'void' } })
    assert.equal(c.qs.find((x) => x.id === 'clutch')!.hotTake?.bonus, 0)
    assert.equal(c.stillPlayable, 0)
  })
  it('ignores declared questions beyond the cap', () => {
    const p = pred(1, { answers, hotTakes: { teams: [], questions: ['mvp', 'roy', 'dpoy'] } })
    assert.deepEqual(declaredHotTakes(p).questions, ['mvp', 'roy'])
    const c = scoreUser(p, emptyCtx(), BASE_WINS, {})
    assert.equal(c.qs.find((x) => x.id === 'dpoy')!.hotTake, null)
  })
})

describe('stillPlayable', () => {
  it('sums answered pending questions, doubled for a retained hot take', () => {
    const preds = [
      pred(1, { answers: { mvp: 'a', clutch: 'rare', champion: 'NYK', finalistE: 'NYK' }, hotTakes: { teams: ['SAS'], questions: ['clutch'] } }),
      ...[2, 3, 4, 5].map((i) => pred(i, { answers: { clutch: `p${i}` } })),
    ]
    const ctx = buildLockContext(preds, {})
    const c = scoreUser(preds[0], ctx, BASE_WINS, {
      mvp: { status: 'final', winners: ['a'], source: 'auto' },
      finalistE: { status: 'void' },
    })
    // pending & answered: clutch (20 + 20 retained 🔥) + champion (30); mvp is final, finalistE void
    assert.equal(c.stillPlayable, 20 + 20 + 30)
  })
  it('is 0 once everything is decided', () => {
    const results: Results = Object.fromEntries(QUESTIONS.map((q) => [q.id, { status: 'final', winners: [], source: 'auto' }]))
    assert.equal(scoreUser(pred(1, { answers: { mvp: 'a' } }), emptyCtx(), BASE_WINS, results).stillPlayable, 0)
  })
})

// ---------------------------------------------------------------- leaderboard

describe('leaderboard', () => {
  it('sorts by total, then grid, then oldest last save, then pseudo (fr)', () => {
    const sorted = leaderboard([
      card('Zoé', 500, 300, '2026-10-16T10:00:00Z'),
      card('Max', 600, 380, '2026-10-19T10:00:00Z'),
      card('Léa', 600, 400, '2026-10-19T10:00:00Z'),
      card('Tom', 600, 380, '2026-10-17T10:00:00Z'),
      card('Emma', 500, 300, '2026-10-16T10:00:00Z'),
      card('Élodie', 500, 300, '2026-10-16T10:00:00Z'),
    ])
    assert.deepEqual(
      sorted.map((c) => c.pseudo),
      ['Léa', 'Tom', 'Max', 'Élodie', 'Emma', 'Zoé'],
    )
    assert.deepEqual(
      sorted.map((c) => c.rank),
      [1, 2, 3, 4, 5, 6],
    )
  })
  it('does not mutate its input', () => {
    const input = [card('B', 1, 1, '2026-10-16T10:00:00Z'), card('A', 2, 1, '2026-10-16T10:00:00Z')]
    leaderboard(input)
    assert.deepEqual(
      input.map((c) => [c.pseudo, c.rank]),
      [
        ['B', 0],
        ['A', 0],
      ],
    )
  })
})

describe('scoreAll', () => {
  it('runs the whole pipeline and ranks everyone', () => {
    const perfect = pred(1, { pseudo: 'Oracle', grid: { order: orderFrom(WINS_2526), wins: WINS_2526 } })
    const base = pred(2, { pseudo: 'Vegas' })
    const invalid = pred(3, { pseudo: 'Brouillon', gridValid: false })
    const preds = [invalid, base, perfect]
    const cards = scoreAll(preds, buildLockContext(preds, {}), standings2526, NORMALIZED_LINES, {}, true)
    assert.deepEqual(
      cards.map((c) => [c.pseudo, c.rank]),
      [
        ['Oracle', 1],
        ['Vegas', 2],
        ['Brouillon', 3],
      ],
    )
    assert.equal(cards[0].grid, 750)
    for (const c of cards) assert.equal(c.total, c.grid + c.questions + c.hotTakes)
  })
  it('before any game, everyone is scored against the lines', () => {
    const preds = [pred(1)]
    const [c] = scoreAll(preds, buildLockContext(preds, {}), [], NORMALIZED_LINES, {}, false)
    for (const t of c.teams) assert.equal(t.actualWins, Math.round(NORMALIZED_LINES[t.abbr]))
  })
})

// ---------------------------------------------------------------- backtest

describe('backtest 2025-26: DraftKings lines rescaled to 1230 vs real records', () => {
  const wins = intTo1230(LINES_2526)
  const grid = { order: orderFrom(wins, LINES_2526), wins }
  const p = pred(1, { grid, wins })

  it('builds a valid grid', () => {
    const status = gridStatus(grid)
    assert.equal(status.total, 1230)
    assert.deepEqual(status.errors, [])
  })
  it('scores a plausible grid (judge measured ~392-406 / 750)', () => {
    const [c] = scoreAll([p], buildLockContext([p], {}), standings2526, LINES_2526, {}, true)
    const winPts = c.teams.reduce((s, t) => s + t.winPts, 0)
    const rankPts = c.teams.reduce((s, t) => s + t.rankPts, 0)
    assert.equal(c.grid, winPts + rankPts)
    // Win points are deterministic and match the judge's simulator exactly (judge-sims/sim.js).
    assert.equal(winPts, 374)
    // Rank points depend on how equal lines are ordered (the judge drew ties at random: 30-39).
    assert.ok(rankPts >= 25 && rankPts <= 45, `rank points ${rankPts}`)
    assert.ok(c.grid >= 395 && c.grid <= 420, `grid ${c.grid}`)
  })
})
