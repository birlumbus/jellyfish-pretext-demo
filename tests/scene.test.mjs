import assert from 'node:assert/strict'
import test from 'node:test'
import { getSceneGeometry, clampTarget } from '../src/scene.ts'
import { carveTextLineSlots } from '../src/intervals.ts'
import { blockedIntervalsForRippleBands } from '../src/ripples.ts'
import { createJellyfishState, layoutObstacleFromState } from '../src/jellyfish.ts'

test('wide screens keep a centered reading measure rather than stretching the passage', () => {
  const scene = getSceneGeometry(1440, 800)
  assert.ok(scene.textRight - scene.textLeft <= 760)
  assert.equal(scene.textLeft, 1440 - scene.textRight)
  assert.ok(scene.fontSize >= 19)
  assert.ok(scene.rippleRadius <= 104, 'The aftermath should stay compact')
})

test('phone text remains readable and its splash cannot erase the entire line', () => {
  const phone = getSceneGeometry(390, 760)
  const desktop = getSceneGeometry(1440, 800)
  assert.ok(phone.textLeft >= 20)
  assert.ok(phone.fontSize >= 18)
  assert.ok(phone.jellyScale < desktop.jellyScale)
  assert.ok(phone.rippleRadius * 2 < (phone.textRight - phone.textLeft) * 0.85)
})

test('a phone ripple leaves readable text beside the fully cleared water', () => {
  for (const width of [320, 344, 360, 390]) for (const age of [0.8, 1.13, 1.23, 1.33]) {
    const scene = getSceneGeometry(width, 760)
    const center = (scene.textLeft + scene.textRight) / 2
    const ripple = { x: center, y: 300, age, kind: 'dive', maxRadius: scene.rippleRadius }
    const blocked = blockedIntervalsForRippleBands([ripple], 299, 328)
    const slots = carveTextLineSlots({ left: scene.textLeft, right: scene.textRight }, blocked, scene.fontSize * 4.5)
    assert.equal(slots.length, 2, `Both side slots should stay readable at ${width}px, age ${age}`)
    assert.ok(slots.every(slot => slot.right <= blocked[0].left || slot.left >= blocked.at(-1).right))
  }
})

test('the enlarged splash leaves readable side slots throughout its droplet flight on phones', () => {
  for (const width of [320, 344, 360, 390]) {
    const scene = getSceneGeometry(width, 760)
    const impact = layoutObstacleFromState(createJellyfishState(width / 2, 250), scene.jellyScale)
    const ripple = { x: impact.cx, y: impact.cy, age: 0, kind: 'dive', maxRadius: scene.rippleRadius,
      impactRadius: impact.r * 1.12 }
    for (let age = 0; age < 0.6; age += 0.02) {
      ripple.age = age
      for (let top = impact.cy - 80; top < impact.cy + 80; top += 4) {
        const blocked = blockedIntervalsForRippleBands([ripple], top, top + scene.lineHeight)
        if (!blocked.length) continue
        const slots = carveTextLineSlots({ left: scene.textLeft, right: scene.textRight }, blocked, scene.minimumLineWidth)
        assert.ok(slots.length >= 2, `Splash erased a side slot at ${width}px, age ${age}, y ${top}`)
      }
    }
  }
})

test('short and narrow screens retain a usable text region', () => {
  for (const [width, height] of [[320, 480], [844, 280], [240, 180]]) {
    const scene = getSceneGeometry(width, height)
    assert.ok(scene.textRight > scene.textLeft)
    assert.ok(scene.textTop + scene.lineHeight <= height - scene.bottomMargin)
  }
})

test('keyboard targets reach the stage edges without being limited to the reading column', () => {
  const scene = getSceneGeometry(390, 760)
  const near = clampTarget(-200, -300, scene)
  const far = clampTarget(3000, 4000, scene)
  assert.deepEqual(near, { x: 0, y: 0 })
  assert.deepEqual(far, { x: 390, y: 760 })
  assert.deepEqual(clampTarget(195, 300, scene), { x: 195, y: 300 })
})
