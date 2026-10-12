import assert from 'node:assert/strict'
import test from 'node:test'
import { carveTextLineSlots } from '../src/intervals.ts'
import { createJellyfishState, layoutObstacleFromState, blockedIntervalsForLayout } from '../src/jellyfish.ts'

test('a displaced text line drops fragments too narrow to read', () => {
  assert.deepEqual(carveTextLineSlots({ left: 24, right: 366 }, [{ left: 64, right: 180 }], 88), [{ left: 180, right: 366 }])
})

test('the phone ripple origin follows the scaled bell center', () => {
  const state = createJellyfishState(100, 100)
  assert.deepEqual(layoutObstacleFromState(state, 0.5), { cx: 100, cy: 151, r: 29 })
})

test('scaled frond and bell bounds stay inside the scaled silhouette footprint', () => {
  const state = createJellyfishState(100, 100)
  const intervals = blockedIntervalsForLayout(state, 156, 164, 0.5)
  assert.ok(intervals.length > 0)
  for (const part of intervals) {
    assert.ok(part.left >= 65)
    assert.ok(part.right <= 135)
  }
})
