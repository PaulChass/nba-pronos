import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PickerOption } from '../../lib/data.ts'
import type { QuestionOdds } from '../../lib/types.ts'
import {
  answeredCount,
  applyPick,
  buildIndex,
  formatPct,
  hotTakeState,
  MAX_MATCHES,
  normalize,
  optionTeam,
  rollbackRefusedHot,
  sameMembers,
  search,
  staleHotTakes,
  topFavorites,
} from './logic.ts'

const players: PickerOption[] = [
  { id: '1', label: 'Nikola Jokić', sub: 'DEN · C' },
  { id: '2', label: 'Victor Wembanyama', sub: 'SAS · C' },
  { id: '3', label: 'De’Aaron Fox', sub: 'SAS · G' },
  { id: '4', label: 'Shai Gilgeous-Alexander', sub: 'OKC · G' },
  { id: '5', label: 'Alex Caruso', sub: 'OKC · G' },
]
const index = buildIndex('player', players)
const ids = (q: string, prefer?: string[]) => search(index, q, { prefer }).matches.map((e) => e.opt.id)

test('normalize strips accents, case and punctuation', () => {
  assert.equal(normalize('Nikola JOKIĆ'), 'nikola jokic')
  assert.equal(normalize('Gilgeous-Alexander'), 'gilgeous alexander')
})

test('search matches names without accents or case', () => {
  assert.deepEqual(ids('jokic'), ['1'])
  assert.deepEqual(ids('JOKIĆ'), ['1'])
  assert.deepEqual(ids('deaaron'), ['3'])
  assert.deepEqual(ids('gilgeous-al'), ['4'])
})

test('search matches on the team (tricode or name), alphabetically', () => {
  assert.deepEqual(ids('spurs'), ['3', '2'])
  assert.deepEqual(ids('san antonio'), ['3', '2'])
  assert.deepEqual(ids('okc'), ['5', '4'])
})

test('name prefixes rank before inner and team matches', () => {
  // "alex": Alex Caruso (prefix) before Gilgeous-Alexander (word prefix)
  assert.deepEqual(ids('alex'), ['5', '4'])
})

test('empty query lists everything, preferred teams first, capped', () => {
  assert.deepEqual(ids(''), ['5', '3', '1', '4', '2'])
  assert.deepEqual(ids('', ['SAS']), ['3', '2', '5', '1', '4'])
  const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), label: `Joueur ${i}`, sub: 'NYK · G' }))
  const res = search(buildIndex('player', many), '')
  assert.equal(res.matches.length, MAX_MATCHES)
  assert.equal(res.total, 80)
  assert.equal(search(buildIndex('player', many), 'knicks').total, 80)
})

test('optionTeam resolves players, coaches and teams', () => {
  assert.equal(optionTeam('player', players[1])?.abbr, 'SAS')
  assert.equal(optionTeam('coach', { id: '9', label: 'Coach', sub: 'Boston Celtics' })?.abbr, 'BOS')
  assert.equal(optionTeam('teamW', { id: 'OKC', label: 'Oklahoma City Thunder', sub: 'Ouest' })?.abbr, 'OKC')
})

const odds: QuestionOdds = { mvp: { a: 0.6, b: 0.25, c: 0.1, d: 0.05 } }

test('changing a finalist clears a champion that is no longer a finalist', () => {
  const before = { finalistE: 'NYK', finalistW: 'OKC', champion: 'OKC' }
  const kept = applyPick(before, [], 'finalistE', 'BOS', odds)
  assert.equal(kept.answers.champion, 'OKC')
  assert.equal(kept.clearedChampion, false)
  const cleared = applyPick(before, ['champion'], 'finalistW', 'SAS', odds)
  assert.equal(cleared.answers.champion, undefined)
  assert.equal(cleared.clearedChampion, true)
  assert.deepEqual(cleared.droppedHot, ['champion'])
})

test('a hot take is dropped when its pick becomes too likely or is cleared', () => {
  const res = applyPick({ mvp: 'c' }, ['mvp'], 'mvp', 'a', odds)
  assert.deepEqual(res.hotQuestions, [])
  assert.deepEqual(res.droppedHot, ['mvp'])
  assert.deepEqual(applyPick({ mvp: 'c' }, ['mvp'], 'mvp', 'd', odds).hotQuestions, ['mvp'])
  assert.deepEqual(applyPick({ mvp: 'c' }, ['mvp'], 'mvp', null, odds).droppedHot, ['mvp'])
})

test('hot-take toggle state', () => {
  assert.equal(hotTakeState('mvp', {}, [], odds).enabled, false)
  assert.equal(hotTakeState('mvp', { mvp: 'b' }, [], odds).enabled, false) // 0.25 > 0.6 / 3
  assert.equal(hotTakeState('mvp', { mvp: 'c' }, [], odds).enabled, true)
  const full = hotTakeState('mvp', { mvp: 'c' }, ['clutch', 'fmvp'], odds)
  assert.equal(full.enabled, false)
  assert.match(full.reason ?? '', /déjà/)
  assert.equal(hotTakeState('clutch', { clutch: 'x' }, ['clutch', 'fmvp'], odds).enabled, true) // on: can switch off
  const noMarket = hotTakeState('fmvp', { fmvp: 'x' }, [], odds)
  assert.equal(noMarket.noMarket, true)
  assert.equal(noMarket.enabled, false)
  assert.match(noMarket.reason ?? '', /Pas de cote/)
})

test('stale stored hot takes are detected', () => {
  // a is the favourite; fmvp has no odds at all, so no hot take on it either
  assert.deepEqual(staleHotTakes(['mvp', 'fmvp'], { mvp: 'a', fmvp: 'x' }, odds), ['mvp', 'fmvp'])
  assert.deepEqual(staleHotTakes(['mvp'], { mvp: 'c' }, odds), [])
  assert.deepEqual(staleHotTakes(['mvp'], {}, odds), ['mvp']) // no pick any more
})

test('a refused hot-take save only switches off the newly added ones', () => {
  // Stored: mvp. Sent: fmvp added and mvp removed; meanwhile the user added clutch.
  const res = rollbackRefusedHot(['fmvp', 'clutch'], ['fmvp'], ['mvp'])
  assert.deepEqual(res.rolledBack, ['fmvp'])
  assert.deepEqual(res.next, ['clutch'])
  // Nothing new was sent: nothing to roll back (the error is shown instead).
  assert.deepEqual(rollbackRefusedHot(['mvp'], ['mvp'], ['mvp', 'fmvp']).rolledBack, [])
  assert.equal(sameMembers(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameMembers(['a'], ['a', 'b']), false)
})

test('favorites, percentages, progress', () => {
  assert.deepEqual(topFavorites(odds.mvp!).map((f) => f.id), ['a', 'b', 'c'])
  assert.equal(formatPct(0.316), '32 %')
  assert.equal(formatPct(0.001), '< 1 %')
  assert.equal(answeredCount({ mvp: 'a', roy: 'b' }), 2)
})
