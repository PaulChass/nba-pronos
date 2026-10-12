import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { americanToProbability, devig, kambiMarket, normalizeName, playerNameIndex } from './odds-parse.ts'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))
const players = JSON.parse(readFileSync(new URL('../data/players.json', import.meta.url), 'utf8')).players as {
  id: string
  name: string
}[]
const index = playerNameIndex(players)

describe('normalizeName', () => {
  it('drops accents, punctuation and suffixes', () => {
    assert.equal(normalizeName('Luka Dončić'), 'luka doncic')
    assert.equal(normalizeName('Michael Porter Jr.'), 'michael porter')
    assert.equal(normalizeName('Trey Murphy III'), 'trey murphy')
    assert.equal(normalizeName('Shai Gilgeous-Alexander'), 'shai gilgeous alexander')
    assert.equal(normalizeName("De'Aaron Fox"), 'deaaron fox')
  })
  it('never guesses between two players with the same name', () => {
    const idx = playerNameIndex([
      { id: '1', name: 'John Smith' },
      { id: '2', name: 'John Smith Jr.' },
    ])
    assert.equal(idx.get('john smith'), null)
  })
})

describe('Kambi markets', () => {
  it('scoring leader: Doncic favourite, ids from players.json, de-vigged', () => {
    const { market, unmatched } = kambiMarket(fixture('kambi-1028657309.json'), 'League scoring leader - points per game', index)
    assert.ok(market)
    const sorted = Object.entries(market).sort((a, b) => b[1] - a[1])
    assert.equal(sorted[0][0], '3945274') // Luka Doncic
    assert.equal(sorted[1][0], '4278073') // Shai Gilgeous-Alexander
    assert.ok(Math.abs(Object.values(market).reduce((a, b) => a + b, 0) - 1) < 1e-9)
    assert.ok(Object.keys(market).length >= 45, `matched ${Object.keys(market).length}, unmatched: ${unmatched.join(', ')}`)
  })
  it('Finals MVP: SGA and Wembanyama co-favourites', () => {
    const { market } = kambiMarket(fixture('kambi-1028748190.json'), 'NBA Finals MVP', index)
    assert.ok(market)
    const top2 = Object.entries(market).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id).sort()
    assert.deepEqual(top2, ['4278073', '5104157'])
  })
  it('a missing offer gives no market (so no hot take)', () => {
    assert.equal(kambiMarket(fixture('kambi-1028748190.json'), 'Nope', index).market, null)
  })
})

describe('odds maths', () => {
  it('American odds', () => {
    assert.equal(americanToProbability(-110)?.toFixed(4), '0.5238')
    assert.equal(americanToProbability('+250')?.toFixed(4), '0.2857')
    assert.equal(americanToProbability('EVEN'), 0.5)
    assert.equal(americanToProbability('x'), null)
  })
  it('devig', () => {
    assert.deepEqual(devig({ a: 0.6, b: 0.6 }), { a: 0.5, b: 0.5 })
    assert.equal(devig({}), null)
  })
})
