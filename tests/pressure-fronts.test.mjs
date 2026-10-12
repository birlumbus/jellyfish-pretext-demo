import assert from 'node:assert/strict'
import test from 'node:test'
import * as waves from '../src/ripples.ts'
import { getSceneGeometry } from '../src/scene.ts'

test('waves travel farther but still finish within the original fade-out time', () => {
  const scene = getSceneGeometry(1440, 800)
  const ripples = []
  waves.pushRipple(ripples, 400, 300, 'dive', 3, scene.rippleRadius, 70)
  waves.stepRipples(ripples, 1)
  const fronts = waves.getRippleFronts(ripples[0])
  assert.ok(fronts.some(front => front.radius > 95), 'The outgoing wave should spread beyond its previous reach')
  assert.ok(fronts.every(front => front.radius <= 100), 'The extra spread should stay restrained')
  waves.stepRipples(ripples, 0.62)
  assert.equal(ripples.length, 0, 'The larger effect should still finish by 1.62 seconds')
  assert.deepEqual(waves.blockedIntervalsForRippleBands(ripples, 299, 328), [])
})

test('a dive starts with a splash covering its center, then settles into compact waves', () => {
  const effect = { x: 100, y: 200, age: 0, kind: 'dive', maxRadius: 86 }
  const first = waves.getSplashGeometry(effect)
  assert.ok(first && first.opacity > 0.9)
  assert.ok(Math.min(...first.core.map(p => p.x)) < 80 && Math.max(...first.core.map(p => p.x)) > 120)
  assert.equal(waves.getRippleFronts(effect).length, 0, 'The splash should precede the ripples')
  effect.age = 0.2
  const raised = waves.getSplashGeometry(effect)
  assert.ok(raised.droplets.length >= 4)
  assert.ok(Math.min(...raised.crown.map(p => p.y)) < 175, 'Water should lift into a crown')
  effect.age = 0.65
  assert.equal(waves.getSplashGeometry(effect), null)
  const fronts = waves.getRippleFronts(effect)
  assert.ok(fronts.length > 0 && fronts.length <= 2)
  assert.ok(fronts.every(front => front.radius <= 86))
})

test('a visible ripple clears its entire interior along with the crest', () => {
  const front = { x: 100, y: 200, radius: 90, innerRadius: 78, outerRadius: 102, aspectY: 0.84, opacity: 0.5 }
  const blocked = waves.blockedIntervalsForPressureFront(front, 199, 201)
  assert.ok(blocked.some(part => part.left < 10 && part.right > 10))
  assert.ok(blocked.some(part => part.left < 190 && part.right > 190))
  assert.ok(blocked.some(part => part.left <= 100 && part.right >= 100), 'The ripple interior must stay empty')
})

test('the whole disturbance stays clear through every visible wave and then recedes smoothly', () => {
  const ripple = { x: 100, y: 200, age: 0, kind: 'dive', maxRadius: 100 }
  for (let age = 0.05; age < 1.34; age += 0.05) {
    ripple.age = age
    if (waves.getRippleFronts(ripple).length === 0) continue
    const blocked = waves.blockedIntervalsForRippleBands([ripple], 199, 201)
    assert.ok(blocked.some(part => part.left < 100 && part.right > 100), 'The splash and wave center must stay clear')
  }
  const widths = []
  for (let age = 1.33; age <= 1.65; age += 0.015) {
    ripple.age = age
    const blocked = waves.blockedIntervalsForRippleBands([ripple], 199, 201)
    widths.push(blocked.length ? blocked[0].right - blocked[0].left : 0)
  }
  assert.ok(widths[0] > 190)
  assert.equal(widths.at(-1), 0)
  assert.ok(widths.some(width => width > 20 && width < 180), 'The text should return gradually')
  for (let i = 1; i < widths.length; i++) assert.ok(widths[i] <= widths[i - 1] + 1e-8)
})

test('the top of a pressure front still clears a full line band', () => {
  const front = { x: 100, y: 200, radius: 90, innerRadius: 78, outerRadius: 102, aspectY: 0.84, opacity: 0.5 }
  const blocked = waves.blockedIntervalsForPressureFront(front, 115, 133)
  assert.ok(blocked.some(part => part.left < 100 && part.right > 100))
})

test('ripple speed changes affect future travel without jumping the existing crest', () => {
  const ripples = []
  waves.pushRipple(ripples, 100, 200, 'dive', 3, 100)
  waves.stepRipples(ripples, 0.8, 0.25)
  const before = waves.getRippleFronts(ripples[0])[0].radius
  waves.stepRipples(ripples, 0, 2.5)
  assert.equal(waves.getRippleFronts(ripples[0])[0].radius, before)
  waves.stepRipples(ripples, 0.04, 2.5)
  assert.ok(waves.getRippleFronts(ripples[0])[0].radius > before)
})

test('all pressure fronts expire without a lingering text exclusion', () => {
  const ripples = []
  waves.pushRipple(ripples, 100, 200, 'surface', 3, 100)
  waves.stepRipples(ripples, 10, 1)
  assert.equal(ripples.length, 0)
  assert.deepEqual(waves.blockedIntervalsForRippleBands(ripples, 190, 210), [])
})
