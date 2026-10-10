import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyGrid } from '../../lib/validation.ts'
import {
  filledInConf,
  formatInt,
  formatLine,
  moveTeam,
  parseWinsInput,
  sortConfByWins,
  stepWins,
  totalLabel,
  withWins,
} from './grid-utils.ts'

test('parseWinsInput keeps digits and clamps to 0..82', () => {
  assert.equal(parseWinsInput(''), null)
  assert.equal(parseWinsInput('abc'), null)
  assert.equal(parseWinsInput('07'), 7)
  assert.equal(parseWinsInput('5a2'), 52)
  assert.equal(parseWinsInput('90'), 82)
  assert.equal(parseWinsInput('0'), 0)
})

test('stepWins starts empty values at 41 and stays within 0..82', () => {
  assert.equal(stepWins(null, 1), 41)
  assert.equal(stepWins(null, -1), 41)
  assert.equal(stepWins(0, -1), 0)
  assert.equal(stepWins(82, 1), 82)
  assert.equal(stepWins(50, 1), 51)
})

test('withWins and moveTeam return the same grid on no-ops', () => {
  const g = emptyGrid()
  assert.equal(withWins(g, 'BOS', null), g)
  assert.equal(moveTeam(g, 'E', 0, 0), g)
  assert.equal(moveTeam(g, 'E', 0, 15), g)
  const moved = moveTeam(g, 'E', 0, 2)
  assert.deepEqual(moved.order.E.slice(0, 3), [g.order.E[1], g.order.E[2], g.order.E[0]])
  assert.equal(moved.order.W, g.order.W)
})

test('sortConfByWins: most wins first, stable on ties, empty last', () => {
  let g = emptyGrid()
  const [a, b, c, d] = g.order.E
  g = withWins(g, a, 30)
  g = withWins(g, b, 50)
  g = withWins(g, d, 50)
  const sorted = sortConfByWins(g, 'E')
  assert.deepEqual(sorted.order.E.slice(0, 3), [b, d, a])
  assert.ok(sorted.order.E.indexOf(c) > 2)
  assert.equal(sortConfByWins(sorted, 'E'), sorted)
  assert.equal(filledInConf(sorted, 'E'), 3)
  assert.equal(filledInConf(sorted, 'W'), 0)
})

test('totalLabel', () => {
  assert.deepEqual(totalLabel(30, 14), { text: '+14 de trop', tone: 'err' })
  assert.deepEqual(totalLabel(30, -6), { text: 'il en manque 6', tone: 'err' })
  assert.equal(totalLabel(12, -600).tone, 'neutral')
  assert.equal(totalLabel(30, 0).tone, 'ok')
  assert.equal(totalLabel(29, 0).tone, 'warn')
})

test('French number formats', () => {
  assert.equal(formatInt(1230).replace(/\s/g, ' '), '1 230')
  assert.equal(formatLine(51.6), '51,6')
  assert.equal(formatLine(52), '52,0')
})
