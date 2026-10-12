import assert from 'node:assert/strict'
import test from 'node:test'
import { drawRipples, drawSplash, getRippleFronts, getSplashGeometry, blockedIntervalsForRippleBands } from '../src/ripples.ts'
import { createJellyfishState, setJellyfishDepth, stepJellyfish, layoutObstacleFromState } from '../src/jellyfish.ts'
import { getSceneGeometry } from '../src/scene.ts'

test('the peak splash spans more than the bell width at desktop and phone sizes', () => {
  for (const width of [320, 390, 1440]) {
    const scene = getSceneGeometry(width, 648)
    const jelly = createJellyfishState(width / 2, 250)
    const impact = layoutObstacleFromState(jelly, scene.jellyScale)
    const splash = getSplashGeometry({ x: impact.cx, y: impact.cy, age: 0.29, kind: 'dive',
      maxRadius: scene.rippleRadius, impactRadius: impact.r * 1.12 })
    const span = Math.max(...splash.crown.map(point => point.x)) - Math.min(...splash.crown.map(point => point.x))
    assert.ok(span > impact.r * 2.2, `Splash should surround the bell at ${width}px`)
  }
})

function insidePolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

test('the opaque splash covers the bell center through dive and surface depth motion', () => {
  for (const width of [320, 390, 1440]) for (const kind of ['dive', 'surface']) for (const speed of [0.25, 1, 2.5]) {
    const scene = getSceneGeometry(width, 648)
    const jelly = createJellyfishState(width / 2, 250)
    setJellyfishDepth(jelly, kind === 'surface', true)
    const impact = layoutObstacleFromState(jelly, scene.jellyScale)
    const above = layoutObstacleFromState({ ...jelly, depth: 0 }, scene.jellyScale)
    const below = layoutObstacleFromState({ ...jelly, depth: 1 }, scene.jellyScale)
    const ripple = { x: impact.cx, y: impact.cy, age: 0, kind, maxRadius: scene.rippleRadius,
      impactRadius: impact.r * 1.12, depthAtImpact: jelly.depth, depth: jelly.depth,
      depthShift: { x: below.cx - above.cx, y: below.cy - above.cy } }
    setJellyfishDepth(jelly, kind === 'dive')
    for (let frame = 0; frame < 280; frame++) {
      ripple.age = frame / 120 * speed
      ripple.depth = jelly.depth
      const splash = getSplashGeometry(ripple)
      if (!splash || splash.opacity <= 0.85) break
      const center = layoutObstacleFromState(jelly, scene.jellyScale)
      assert.ok(insidePolygon({ x: center.cx, y: center.cy }, splash.core),
        `Bell center exposed at ${width}px, ${kind}, ${speed}x, age ${ripple.age}`)
      stepJellyfish(jelly, width / 2, 250, 1 / 120)
    }
  }
})

test('the whole painted water disturbance stays inside its text clearance', () => {
  for (const maxRadius of [40, 60, 100]) for (const age of [0, 0.03, 0.1, 0.2, 0.4, 0.65, 1, 1.3, 1.5, 1.7]) for (const kind of ['dive', 'surface']) {
    const ripple = { x: 100, y: 200, age, kind, maxRadius, impactRadius: maxRadius * 0.82,
      depthAtImpact: kind === 'dive' ? 0 : 1, depth: kind === 'dive' ? 0.8 : 0.2,
      depthShift: { x: 6, y: 29 } }
    const paths = []
    let points = []
    const gradient = { addColorStop() {} }
    const context = {
      lineWidth: 0,
      save() {}, restore() {},
      createLinearGradient() { return gradient },
      createRadialGradient() { return gradient },
      beginPath() { points = [] },
      moveTo(x, y) { points.push({ x, y }) },
      lineTo(x, y) { points.push({ x, y }) },
      closePath() {},
      ellipse(x, y, rx, ry) {
        for (let i = 0; i <= 64; i++) points.push({ x: x + Math.cos(i * Math.PI / 32) * rx, y: y + Math.sin(i * Math.PI / 32) * ry })
      },
      fill() { paths.push({ points: [...points], half: 0 }) },
      stroke() { paths.push({ points: [...points], half: this.lineWidth / 2 }) },
    }
    drawRipples(context, [ripple])
    drawSplash(context, [ripple])
    assert.equal(paths.length > 0, getRippleFronts(ripple).length > 0 || getSplashGeometry(ripple) !== null)
    for (const path of paths) for (const { x, y } of path.points) {
      const half = path.half
      const blocked = blockedIntervalsForRippleBands([ripple], y - half, y + half)
      assert.ok(blocked.some(part => part.left <= x - half && part.right >= x + half),
        `Paint crosses text clearance at radius ${maxRadius}, age ${age}`)
    }
  }
})
