// Run: node --test src/lib/espn-parse.test.ts — against real ESPN responses saved in __fixtures__/.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  daysBackwards,
  emptyFinalsScan,
  finalsScanDone,
  parseAwardIndex,
  parseAwardWinners,
  parseCalendar,
  parseCupFinal,
  parsePlayoffGames,
  parseScoringLeader,
  parseScoringLines,
  parseStandings,
  scoringLeaders,
  stepFinalsScan,
  usDay,
  type FinalsScan,
} from './espn-parse.ts'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))

const SGA = '4278073'
const LUKA = '3945274'

// ---------------------------------------------------------------- standings

test('standings 2025-26 final: 30 teams, real records', () => {
  const teams = parseStandings(fixture('standings-2026-final.json'), 2026)
  assert.equal(teams.length, 30)
  assert.equal(new Set(teams.map((t) => t.abbr)).size, 30)
  assert.equal(teams.filter((t) => t.conference === 'E').length, 15)
  assert.deepEqual(teams.find((t) => t.abbr === 'TOR'), { abbr: 'TOR', conference: 'E', w: 46, l: 36 })
  assert.equal(teams.reduce((s, t) => s + t.w, 0), 1230)
  assert.equal(teams.reduce((s, t) => s + t.l, 0), 1230)
  // ESPN abbreviations differ from tricodes for a few teams (NY, GS, SA, NO, UTAH, WSH).
  for (const abbr of ['NYK', 'GSW', 'SAS', 'NOP', 'UTA', 'WAS']) assert.ok(teams.some((t) => t.abbr === abbr), abbr)
  assert.equal(teams.find((t) => t.abbr === 'DET')?.w, 60)
})

test('standings: refuses another season than requested', () => {
  assert.throws(() => parseStandings(fixture('standings-2026-final.json'), 2027), /season 2026/)
})

test('standings 2026-27 before tip-off: 30 teams at 0-0', () => {
  const teams = parseStandings(fixture('standings-2027-preseason.json'), 2027)
  assert.equal(teams.length, 30)
  assert.ok(teams.every((t) => t.w === 0 && t.l === 0))
})

test('standings: incomplete or junk payloads throw', () => {
  const json = fixture('standings-2026-final.json') as { children: { standings: { entries: unknown[] } }[] }
  json.children[0].standings.entries.pop()
  assert.throws(() => parseStandings(json), /29 teams/)
  assert.throws(() => parseStandings({}), /0 teams/)
  assert.throws(() => parseStandings(null), /0 teams/)
})

// ---------------------------------------------------------------- awards

test('awards 2025-26: MVP is SGA, shared lists give every winner', () => {
  assert.deepEqual(parseAwardWinners(fixture('awards-2026/33.json')), [SGA])
  assert.deepEqual(parseAwardWinners(fixture('awards-2026/297.json')), [SGA]) // Clutch
  assert.deepEqual(parseAwardWinners(fixture('awards-2026/35.json')), ['5041939']) // ROY Cooper Flagg
  assert.equal(parseAwardWinners(fixture('awards-2026/44.json')).length, 5) // All-NBA 1st team
  assert.deepEqual(parseAwardWinners({ winners: [] }), [])
  assert.deepEqual(parseAwardWinners(undefined), [])
})

test('awards index lists the published award ids', () => {
  const ids = parseAwardIndex(fixture('awards-2026-index.json'))
  assert.equal(ids.length, 20)
  for (const id of [33, 35, 36, 39, 40, 43, 297]) assert.ok(ids.includes(id), String(id))
  assert.deepEqual(parseAwardIndex({ items: [] }), [])
})

// ---------------------------------------------------------------- NBA Cup

test('Cup final 2025 (Dec 16): Knicks beat the Spurs', () => {
  assert.equal(parseCupFinal(fixture('scoreboard-2025-12-16-cup-final.json')), 'NYK')
})

test('Cup: no final that day, or final not over -> null', () => {
  assert.equal(parseCupFinal(fixture('scoreboard-cup-final-2025.json')), null) // Dec 17: regular games
  assert.equal(parseCupFinal(fixture('scoreboard-playoffs-2026.json')), null) // no events
  const live = fixture('scoreboard-2025-12-16-cup-final.json') as {
    events: { competitions: { status: { type: { completed: boolean } } }[] }[]
  }
  live.events[0].competitions[0].status.type.completed = false
  assert.equal(parseCupFinal(live), null)
})

// ---------------------------------------------------------------- playoffs

test('playoff games: rounds, series state and winners', () => {
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2026-06-13.json')), [
    { round: 'finals', conference: null, teams: ['SAS', 'NYK'], seriesOver: true, winner: 'NYK' },
  ])
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2026-05-30.json')), [
    { round: 'confFinals', conference: 'W', teams: ['OKC', 'SAS'], seriesOver: true, winner: 'SAS' },
  ])
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2026-05-28.json')), [
    { round: 'confFinals', conference: 'W', teams: ['SAS', 'OKC'], seriesOver: false, winner: null },
  ])
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2026-05-25.json')), [
    { round: 'confFinals', conference: 'E', teams: ['CLE', 'NYK'], seriesOver: true, winner: 'NYK' },
  ])
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2026-05-12.json')), [
    { round: 'early', conference: 'W', teams: ['SAS', 'MIN'], seriesOver: false, winner: null },
  ])
  // The Cup final carries a `series` object too, but it is a regular-season event.
  assert.deepEqual(parsePlayoffGames(fixture('scoreboard-2025-12-16-cup-final.json')), [])
})

const scan = (...days: string[]): FinalsScan => {
  let s = emptyFinalsScan()
  for (const d of days) {
    s = stepFinalsScan(s, parsePlayoffGames(fixture(`scoreboard-${d}.json`)))
    if (finalsScanDone(s)) break
  }
  return s
}

test('finals scan after the Finals: both finalists and the champion from one day', () => {
  const s = scan('2026-06-13')
  assert.equal(finalsScanDone(s), true)
  assert.deepEqual([s.finalistE, s.finalistW, s.champion], ['NYK', 'SAS', 'NYK'])
})

test('finals scan between the conference finals and the Finals', () => {
  const s = scan('2026-05-30', '2026-05-28', '2026-05-25')
  assert.equal(finalsScanDone(s), true)
  assert.deepEqual([s.finalistE, s.finalistW, s.champion], ['NYK', 'SAS', null])
})

test('finals scan while the West finals are still going', () => {
  const s = scan('2026-05-28', '2026-05-25')
  assert.equal(finalsScanDone(s), true)
  assert.deepEqual([s.finalistE, s.finalistW, s.champion], ['NYK', null, null])
})

test('finals scan during the conference semis: nothing decided', () => {
  const s = scan('2026-05-12')
  assert.equal(s.settled.W, true)
  assert.equal(finalsScanDone(s), false) // the East is still unknown: keep scanning older days
  assert.deepEqual([s.finalistE, s.finalistW, s.champion], [null, null, null])
})

test('scoreboard calendar gives the season game days', () => {
  const days = parseCalendar(fixture('scoreboard-2026-05-12.json'))
  assert.ok(days.includes('2026-06-13'))
  assert.ok(days.includes('2026-05-30'))
  assert.ok(!days.includes('2026-06-01'))
  assert.deepEqual(days, [...days].sort())
})

// ---------------------------------------------------------------- scoring leader

test('scoring leader 2025-26 is Luka Doncic (qualified list)', () => {
  assert.equal(parseScoringLeader(fixture('leaders-byathlete-2026.json')), LUKA)
})

test('scoring leader 2025-26 from the unqualified list sorted by total points', () => {
  const json = fixture('leaders-byathlete-2026-all-by-points.json')
  const lines = parseScoringLines(json, 2026)
  assert.equal(lines.length, 50)
  assert.deepEqual(lines[0], { id: LUKA, name: 'Luka Doncic', gp: 64, points: 2143 })
  assert.equal(parseScoringLeader(json), LUKA)
  assert.throws(() => parseScoringLines(json, 2027), /season 2026/)
})

test('scoring leader: the 58-game rule and its exception', () => {
  const luka = { id: LUKA, name: 'Luka', gp: 64, points: 2143 } // 33.48 ppg
  // 40 ppg in 50 games: 2000 / 58 = 34.5 still beats Luka -> he qualifies and leads.
  assert.deepEqual(scoringLeaders([luka, { id: '1', name: 'A', gp: 50, points: 2000 }]), ['1'])
  // 34 ppg in 50 games: 1700 / 58 = 29.3 -> not qualified, Luka leads.
  assert.deepEqual(scoringLeaders([luka, { id: '2', name: 'B', gp: 50, points: 1700 }]), [LUKA])
  // Exact tie: both score.
  assert.deepEqual(scoringLeaders([luka, { id: '3', name: 'C', gp: 64, points: 2143 }]), [LUKA, '3'])
  assert.deepEqual(scoringLeaders([]), [])
})

// ---------------------------------------------------------------- dates

test('US scoreboard day and day ranges', () => {
  assert.equal(usDay(new Date('2026-06-14T00:30:00Z')), '2026-06-13') // 8:30 pm ET game
  assert.equal(usDay(new Date('2026-06-14T12:00:00Z')), '2026-06-14')
  assert.deepEqual(daysBackwards('2026-05-30', '2026-05-28'), ['2026-05-30', '2026-05-29', '2026-05-28'])
  assert.deepEqual(daysBackwards('2026-05-28', '2026-05-30'), [])
})
