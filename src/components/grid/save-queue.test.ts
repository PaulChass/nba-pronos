import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSerialQueue } from './save-queue.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

test('createSerialQueue runs tasks one at a time, in order', async () => {
  const q = createSerialQueue()
  const log: string[] = []
  let running = 0
  let maxRunning = 0
  const task = (name: string) => async () => {
    running++
    maxRunning = Math.max(maxRunning, running)
    log.push(`start ${name}`)
    await tick()
    log.push(`end ${name}`)
    running--
  }
  void q.push(task('a'))
  void q.push(task('b'))
  await q.push(task('c'))
  assert.equal(maxRunning, 1)
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
})

test('createSerialQueue: each task sees the state the previous one left (no shared expected version)', async () => {
  const q = createSerialQueue()
  let version = 0
  const sent: number[] = []
  const save = async () => {
    const expected = version // read at dispatch, not when queued
    sent.push(expected)
    await tick()
    version = expected + 1
  }
  void q.push(save)
  void q.push(save)
  void q.push(save)
  await q.idle()
  assert.deepEqual(sent, [0, 1, 2])
  assert.equal(version, 3)
})

test('createSerialQueue keeps going after a failing task and reports it', async () => {
  const errors: unknown[] = []
  const q = createSerialQueue({ onError: (e) => errors.push(e) })
  const log: string[] = []
  void q.push(() => {
    throw new Error('boom')
  })
  void q.push(async () => {
    await tick()
    throw new Error('async boom')
  })
  await q.push(() => log.push('after'))
  assert.deepEqual(log, ['after'])
  assert.deepEqual(
    errors.map((e) => (e as Error).message),
    ['boom', 'async boom'],
  )
})

test('createSerialQueue tracks its size and idle() waits for queued tasks', async () => {
  const sizes: number[] = []
  const q = createSerialQueue({ onSizeChange: (n) => sizes.push(n) })
  assert.equal(q.size, 0)
  let done = 0
  void q.push(async () => {
    await tick()
    done++
  })
  void q.push(async () => {
    await tick()
    done++
  })
  assert.equal(q.size, 2)
  await q.idle()
  assert.equal(done, 2)
  assert.equal(q.size, 0)
  assert.deepEqual(sizes, [1, 2, 1, 0])
  await q.idle() // an idle queue resolves at once
})
