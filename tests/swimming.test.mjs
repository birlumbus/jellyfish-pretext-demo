import assert from 'node:assert/strict'
import test from 'node:test'
import * as jellyfish from '../src/jellyfish.ts'
import { readFileSync } from 'node:fs'

test('the bell keeps a fixed shape at rest and while following the pointer', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  const initial = jellyfish.getJellyfishGeometry(state)
  const shape = { width: initial.width, height: initial.height }
  for (let i = 0; i < 240; i++) {
    const targetX = i < 120 ? 200 : 200 + Math.sin(i * 0.4) * 400
    jellyfish.stepJellyfish(state, targetX, 200, 1 / 120)
    const geometry = jellyfish.getJellyfishGeometry(state)
    assert.deepEqual({ width: geometry.width, height: geometry.height }, shape)
  }
})

test('the cap and trailing base follow the original demo motion', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/original-follow.json', import.meta.url)))
  const state = jellyfish.createJellyfishState(fixture.start.x, fixture.start.y)
  for (const leg of fixture.legs) {
    for (let i = 0; i < leg.frames; i++) jellyfish.stepJellyfish(state, leg.x, leg.y, fixture.dt)
    for (const [key, expected] of Object.entries(leg.expected)) {
      assert.ok(Math.abs(state[key] - expected) < 1e-8, `${key} must match the original follow motion`)
    }
  }
})

test('the cap eases toward the cursor and points along the leading apex and trailing base', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  const before = jellyfish.getJellyfishGeometry(state)
  jellyfish.stepJellyfish(state, 600, 200, 1 / 60)
  assert.ok(state.apexX > 200 && state.apexX < 600, 'The cap must follow gradually rather than teleport')
  for (let i = 0; i < 60; i++) jellyfish.stepJellyfish(state, 600, 200, 1 / 60)
  const geometry = jellyfish.getJellyfishGeometry(state)
  assert.notEqual(geometry, before)
  const dx = state.apexX - state.x, dy = state.apexY - state.y
  const length = Math.hypot(dx, dy)
  assert.ok(Math.abs(geometry.down.x + dx / length) < 1e-8)
  assert.ok(Math.abs(geometry.down.y + dy / length) < 1e-8)
  assert.ok(geometry.down.x < -0.5, 'The cap should point toward a cursor on its right')
  const frozen = [state.x, state.y, state.apexX, state.apexY]
  for (let i = 0; i < 600; i++) jellyfish.stepJellyfish(state, 600, 200, 1 / 60)
  const resting = [state.x, state.y, state.apexX, state.apexY]
  for (let i = 0; i < 120; i++) jellyfish.stepJellyfish(state, 600, 200, 1 / 60)
  assert.ok(state.apexX > frozen[2])
  for (const [i, value] of [state.x, state.y, state.apexX, state.apexY].entries()) {
    assert.ok(Math.abs(value - resting[i]) < 0.001, 'The resting cap must stay still')
  }
})

test('text exclusions contain the drawn bell and curved tentacles through a turn', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  for (let phase = 0; phase < 5; phase++) {
    for (let i = 0; i < 30; i++) jellyfish.stepJellyfish(state, 300 + Math.sin(phase) * 120, 180 + Math.cos(phase) * 80, 1 / 120)
    for (const scale of [0.58, 1.08]) {
      const geometry = jellyfish.getJellyfishGeometry(state, scale)
      for (const outline of [geometry.bell, ...geometry.tentacles]) {
        for (let i = 0; i < outline.length; i += 7) {
          const point = outline[i]
          const blocked = jellyfish.blockedIntervalsForLayout(state, point.y - 0.5, point.y + 0.5, scale)
          assert.ok(blocked.some(part => point.x >= part.left && point.x <= part.right))
        }
      }
    }
  }
})

test('guided tendrils curve gently behind the cap and stay within their spring reach', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  for (let i = 0; i < 90; i++) jellyfish.stepJellyfish(state, 500, 200, 1 / 60)
  for (let i = 0; i < 30; i++) jellyfish.stepJellyfish(state, 160, 40, 1 / 60)
  for (const frond of state.fronds) {
    assert.ok(Number.isFinite(frond.tipX) && Number.isFinite(frond.tipY))
  }
  const { tentacles } = jellyfish.getJellyfishGeometry(state)
  for (let i = 0; i < tentacles.length; i++) {
    const root = tentacles[i][0], tip = state.fronds[i]
    assert.ok(Math.hypot(tip.tipX - root.x, tip.tipY - root.y) <= tip.length + 22)
    const chordX = tip.tipX - root.x, chordY = tip.tipY - root.y
    const mid = tentacles[i][12]
    const deviation = Math.abs((mid.x - root.x) * chordY - (mid.y - root.y) * chordX) / Math.max(1, Math.hypot(chordX, chordY))
    assert.ok(deviation > 0.5, 'Tendrils should retain soft curved flow')
  }
})

test('fronds drift noticeably in quiet water while the cap stays still', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  let minX = Infinity, maxX = -Infinity
  for (let i = 0; i < 1200; i++) {
    jellyfish.stepJellyfish(state, 200, 200, 1 / 120)
    minX = Math.min(minX, state.fronds[0].tipX)
    maxX = Math.max(maxX, state.fronds[0].tipX)
    assert.equal(state.apexX, 200)
    assert.equal(state.apexY, 200)
  }
  assert.ok(maxX - minX > 24, 'The fronds need broad water-driven drift rather than a tiny sway')
})

test('frond momentum carries on after an impulse instead of being damped immediately', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  const frond = state.fronds[0]
  const startX = frond.tipX
  frond.vx = 100
  for (let i = 0; i < 15; i++) jellyfish.stepJellyfish(state, 200, 200, 1 / 120)
  assert.ok(frond.vx > 35, 'A swish should still have momentum an eighth of a second later')
  assert.ok(frond.tipX > startX + 7)
})

test('diving moves through intermediate depth and can reverse smoothly', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  jellyfish.setJellyfishDepth(state, true)
  jellyfish.stepJellyfish(state, 200, 200, 0.1)
  assert.ok(state.depth > 0 && state.depth < 1)
  const diving = state.depth
  jellyfish.setJellyfishDepth(state, false)
  assert.equal(state.depth, diving)
  for (let i = 0; i < 120; i++) jellyfish.stepJellyfish(state, 200, 200, 1 / 120)
  assert.ok(state.depth < 0.01)
})

test('Still water can change depth immediately without starting a swimming cycle', () => {
  const state = jellyfish.createJellyfishState(200, 200)
  jellyfish.setJellyfishDepth(state, true, true)
  assert.equal(state.depth, 1)
  const before = structuredClone(state)
  jellyfish.stepJellyfish(state, 500, 100, 0)
  assert.deepEqual(state, before)
})

test('rapid cursor reversals stay finite across supported swim speeds', () => {
  for (const [dt, speed] of [[1 / 120, 0.25], [1 / 60, 1], [1 / 20, 2.5]]) {
    const state = jellyfish.createJellyfishState(200, 200)
    for (let i = 0; i < 120; i++) {
      const x = i % 2 ? 1000 : 0, y = i % 3 ? 0 : 700
      jellyfish.stepJellyfish(state, x, y, dt, speed)
      for (const key of ['x', 'y', 'apexX', 'apexY']) assert.ok(Number.isFinite(state[key]))
      for (const frond of state.fronds) {
        assert.ok(Number.isFinite(frond.tipX) && Number.isFinite(frond.tipY))
      }
    }
  }
})
