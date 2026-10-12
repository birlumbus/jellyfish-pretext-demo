import { mergeIntervals, type Interval } from './intervals.ts'

type Point = { x: number; y: number }
type Frond = { tipX: number; tipY: number; vx: number; vy: number; bend: number; bendVelocity: number; length: number; width: number; phase: number }

const BELL_WIDTH = 52
const BELL_HEIGHT = 68
// Original demo attraction, drag, and trailing-base spring parameters.
const BELL_REST_LENGTH = BELL_HEIGHT
const SMOOTH_CURSOR_TAU = 0.028
const K_ATTRACT = 86
const DRAG_LINEAR = 18
const DRAG_QUAD = 0.024
const MAX_SPEED_APEX = 340
const K_BASE = 50
const BASE_DRAG_LINEAR = 13
const BASE_DRAG_QUAD = 0.015
const MAX_SPEED_BASE = 260
const LENGTH_RELAX = 0.42
const LENGTHS = [62, 82, 72, 96, 75, 86, 66]
const WIDTHS = [5.5, 3.8, 6.2, 4.0, 6.0, 3.6, 5.0]
export const BODY_RADIUS_LAYOUT = 58

export type JellyfishState = {
  x: number; y: number
  apexX: number; apexY: number
  apexVx: number; apexVy: number
  baseVx: number; baseVy: number
  smoothX: number; smoothY: number
  time: number
  depth: number
  depthTarget: number
  revision: number
  fronds: Frond[]
}

export function getBellGeometry() {
  return { width: BELL_WIDTH, height: BELL_HEIGHT }
}

function basis(state: JellyfishState) {
  const dx = state.apexX - state.x, dy = state.apexY - state.y
  const length = Math.hypot(dx, dy) || 1
  const forward = { x: dx / length, y: dy / length }
  return { forward, across: { x: -forward.y, y: forward.x }, down: { x: -forward.x, y: -forward.y } }
}

function anchorAt(state: JellyfishState, index: number): Point {
  const { across, forward } = basis(state)
  const width = BELL_WIDTH
  const acrossPosition = width * (-0.80 + 1.60 * index / (LENGTHS.length - 1))
  return { x: state.x + across.x * acrossPosition + forward.x * 3,
    y: state.y + across.y * acrossPosition + forward.y * 3 }
}

export function createJellyfishState(cursorX: number, cursorY: number): JellyfishState {
  const state: JellyfishState = {
    x: cursorX, y: cursorY + BELL_HEIGHT,
    apexX: cursorX, apexY: cursorY, time: 0,
    apexVx: 0, apexVy: 0, baseVx: 0, baseVy: 0, smoothX: cursorX, smoothY: cursorY,
    depth: 0, depthTarget: 0, revision: 0, fronds: [],
  }
  for (let i = 0; i < LENGTHS.length; i++) {
    const anchor = anchorAt(state, i)
    const length = LENGTHS[i]!
    const { down } = basis(state)
    state.fronds.push({ tipX: anchor.x + down.x * length, tipY: anchor.y + down.y * length,
      vx: 0, vy: 0, bend: 0, bendVelocity: 0, length, width: WIDTHS[i]!, phase: i * 1.83 })
  }
  return state
}

export function setJellyfishDepth(state: JellyfishState, below: boolean, immediate = false): void {
  state.depthTarget = below ? 1 : 0
  if (immediate) state.depth = state.depthTarget
  state.revision++
}

function clampSpeed(vx: number, vy: number, max: number): { x: number; y: number } {
  const s = Math.hypot(vx, vy)
  if (s <= max || s < 1e-6) return { x: vx, y: vy }
  const k = max / s
  return { x: vx * k, y: vy * k }
}

function waterAccel(vx: number, vy: number, kLinear: number, kQuad: number): { ax: number; ay: number } {
  const sp = Math.hypot(vx, vy)
  const drag = kLinear + kQuad * sp
  return { ax: -vx * drag, ay: -vy * drag }
}

/** Original apex attraction and trailing-base motion, without pulse propulsion. */
function stepFollowingBody(state: JellyfishState, targetX: number, targetY: number, dt: number): void {
  const smoothAlpha = 1 - Math.exp(-dt / SMOOTH_CURSOR_TAU)
  state.smoothX += (targetX - state.smoothX) * smoothAlpha
  state.smoothY += (targetY - state.smoothY) * smoothAlpha

  let { apexX, apexY, apexVx, apexVy, x: baseX, y: baseY, baseVx, baseVy } = state

  const goalX = state.smoothX
  const goalY = state.smoothY

  const toCursorX = goalX - apexX
  const toCursorY = goalY - apexY
  let ax = toCursorX * K_ATTRACT
  let ay = toCursorY * K_ATTRACT
  const wA = waterAccel(apexVx, apexVy, DRAG_LINEAR, DRAG_QUAD)
  ax += wA.ax
  ay += wA.ay
  apexVx += ax * dt
  apexVy += ay * dt
  const capA = clampSpeed(apexVx, apexVy, MAX_SPEED_APEX)
  apexVx = capA.x
  apexVy = capA.y
  apexX += apexVx * dt
  apexY += apexVy * dt

  const dx = apexX - baseX
  const dy = apexY - baseY
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist
  const idealBaseX = apexX - ux * BELL_REST_LENGTH
  const idealBaseY = apexY - uy * BELL_REST_LENGTH

  let bx = (idealBaseX - baseX) * K_BASE
  let by = (idealBaseY - baseY) * K_BASE
  const wB = waterAccel(baseVx, baseVy, BASE_DRAG_LINEAR, BASE_DRAG_QUAD)
  bx += wB.ax
  by += wB.ay
  baseVx += bx * dt
  baseVy += by * dt
  const capB = clampSpeed(baseVx, baseVy, MAX_SPEED_BASE)
  baseVx = capB.x
  baseVy = capB.y
  baseX += baseVx * dt
  baseY += baseVy * dt

  {
    const ddx = apexX - baseX
    const ddy = apexY - baseY
    const dlen = Math.hypot(ddx, ddy) || 1
    const err = dlen - BELL_REST_LENGTH
    const fix = err * LENGTH_RELAX
    const fx = (ddx / dlen) * fix
    const fy = (ddy / dlen) * fix
    baseX += fx
    baseY += fy
    apexX -= fx
    apexY -= fy
  }

  state.x = baseX
  state.y = baseY
  state.baseVx = baseVx
  state.baseVy = baseVy
  state.apexX = apexX
  state.apexY = apexY
  state.apexVx = apexVx
  state.apexVy = apexVy

}

function stepFronds(state: JellyfishState, dt: number): void {
  const { across, down } = basis(state)
  for (let i = 0; i < state.fronds.length; i++) {
    const frond = state.fronds[i]!
    const root = anchorAt(state, i)
    const swayT = state.time * (0.74 + i * 0.035)
    const sway = Math.sin(swayT + frond.phase) * 13 + Math.sin(swayT * 0.57 + frond.phase * 1.3) * 4.5
    const targetX = root.x + down.x * frond.length + across.x * sway + state.baseVx * 0.14
    const targetY = root.y + down.y * frond.length + across.y * sway + state.baseVy * 0.09
    // Softer, underdamped tips keep a swish moving after the bell has changed direction.
    frond.vx += ((targetX - frond.tipX) * 16 - frond.vx * 4.8) * dt
    frond.vy += ((targetY - frond.tipY) * 16 - frond.vy * 4.8) * dt
    frond.tipX += frond.vx * dt; frond.tipY += frond.vy * dt
    const driftAcross = state.baseVx * across.x + state.baseVy * across.y
    const bendTarget = Math.sin(swayT * 0.82 + frond.phase + 1.1) * 14 - driftAcross * 0.045
    frond.bendVelocity += ((bendTarget - frond.bend) * 7 - frond.bendVelocity * 2.8) * dt
    frond.bend += frond.bendVelocity * dt
    if (Math.abs(frond.bend) > 26) { frond.bend = Math.sign(frond.bend) * 26; frond.bendVelocity *= 0.5 }
    const dx = frond.tipX - root.x, dy = frond.tipY - root.y
    const distance = Math.hypot(dx, dy)
    const reach = frond.length + 18
    if (distance > reach) {
      frond.tipX = root.x + dx * reach / distance
      frond.tipY = root.y + dy * reach / distance
      const nx = dx / distance, ny = dy / distance
      const radialVelocity = frond.vx * nx + frond.vy * ny
      if (radialVelocity > 0) { frond.vx -= nx * radialVelocity; frond.vy -= ny * radialVelocity }
    }
  }
}

export function stepJellyfish(state: JellyfishState, targetX: number, targetY: number, dt: number, swimSpeed = 1): void {
  if (dt <= 0 || !Number.isFinite(dt)) return
  const elapsed = Math.min(dt, 0.125)
  state.depth += (state.depthTarget - state.depth) * (1 - Math.exp(-elapsed / 0.16))
  if (Math.abs(state.depthTarget - state.depth) < 0.001) state.depth = state.depthTarget
  const motionTime = Math.min(elapsed * Math.max(0.25, Math.min(2.5, swimSpeed)), 0.125)
  stepFollowingBody(state, targetX, targetY, motionTime)
  const count = Math.ceil(motionTime / (1 / 120))
  const h = motionTime / count
  for (let i = 0; i < count; i++) {
    state.time += h
    stepFronds(state, h)
  }
  state.revision++
}

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t
  return { x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y }
}

function bellOutline(width: number, height: number): Point[] {
  const points: Point[] = []
  const left = { x: -width, y: 0 }, top = { x: 0, y: -height }, right = { x: width, y: 0 }
  for (let i = 0; i <= 24; i++) points.push(cubic(left,
    { x: -width, y: -height * 0.60 }, { x: -width * 0.50, y: -height }, top, i / 24))
  for (let i = 1; i <= 24; i++) points.push(cubic(top,
    { x: width * 0.50, y: -height }, { x: width, y: -height * 0.60 }, right, i / 24))
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    points.push({ x: width * (1 - 2 * t), y: -16 * t * (1 - t) })
  }
  return points
}

function tentacleOutline(state: JellyfishState, frond: Frond, index: number): Point[] {
  const root = anchorAt(state, index)
  const tip = { x: frond.tipX, y: frond.tipY }
  const { across, down } = basis(state)
  // The delayed bend carries water flow through each ribbon, independently of its tip.
  const c1 = { x: root.x + down.x * frond.length * 0.36 + across.x * frond.bend * 0.55,
    y: root.y + down.y * frond.length * 0.36 + across.y * frond.bend * 0.55 }
  const c2 = { x: tip.x - down.x * frond.length * 0.30 - across.x * frond.bend * 0.8,
    y: tip.y - down.y * frond.length * 0.30 - across.y * frond.bend * 0.8 }
  const center = Array.from({ length: 33 }, (_, j) => cubic(root, c1, c2, tip, j / 32))
  const left: Point[] = [], right: Point[] = []
  for (let j = 0; j < center.length; j++) {
    const a = center[Math.max(0, j - 1)]!, b = center[Math.min(center.length - 1, j + 1)]!
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const width = frond.width * (1 - j / (center.length - 1)) ** 0.65 * 0.5 + 0.25
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length
    const point = center[j]!
    left.push({ x: point.x + nx * width, y: point.y + ny * width })
    right.push({ x: point.x - nx * width, y: point.y - ny * width })
  }
  return [...left, ...right.reverse()]
}

function computeJellyfishGeometry(state: JellyfishState, scale: number) {
  const { across, down } = basis(state)
  const bell = getBellGeometry()
  const effectiveScale = scale * (1 - state.depth * 0.18)
  const depthOffset = state.depth * 22 * scale
  const worldPoint = (point: Point): Point => ({
    x: state.x + (point.x - state.x) * effectiveScale,
    y: state.y + (point.y - state.y) * effectiveScale + depthOffset,
  })
  const localBell = bellOutline(bell.width, bell.height)
  const bellPoints = localBell.map(point => worldPoint({
    x: state.x + across.x * point.x + down.x * point.y,
    y: state.y + across.y * point.x + down.y * point.y,
  }))
  return {
    ...bell, localBell, bell: bellPoints, origin: worldPoint({ x: state.x, y: state.y }),
    tentacles: state.fronds.map((frond, i) => tentacleOutline(state, frond, i).map(worldPoint)),
    across, down, effectiveScale, depthOffset,
    opacity: 1 - state.depth * 0.74,
  }
}

type JellyfishGeometry = ReturnType<typeof computeJellyfishGeometry>
const geometryCache = new WeakMap<JellyfishState, { revision: number; scale: number; geometry: JellyfishGeometry }>()

/** One outline calculation per pose is shared by all text lines and the renderer. */
export function getJellyfishGeometry(state: JellyfishState, scale = 1): JellyfishGeometry {
  const cached = geometryCache.get(state)
  if (cached?.revision === state.revision && cached.scale === scale) return cached.geometry
  const geometry = computeJellyfishGeometry(state, scale)
  geometryCache.set(state, { revision: state.revision, scale, geometry })
  return geometry
}

function path(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath()
  ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y)
  ctx.closePath()
}

export function drawJellyfish(ctx: CanvasRenderingContext2D, state: JellyfishState, options?: { scale?: number }): void {
  const geometry = getJellyfishGeometry(state, options?.scale ?? 1)
  ctx.save()
  ctx.globalAlpha = geometry.opacity
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  for (const outline of geometry.tentacles) {
    path(ctx, outline)
    ctx.fillStyle = 'rgba(152, 220, 203, 0.23)'; ctx.fill()
    ctx.strokeStyle = 'rgba(152, 220, 203, 0.40)'; ctx.lineWidth = 0.7; ctx.stroke()
  }
  ctx.translate(geometry.origin.x, geometry.origin.y)
  ctx.scale(geometry.effectiveScale, geometry.effectiveScale)
  ctx.transform(geometry.across.x, geometry.across.y, geometry.down.x, geometry.down.y, 0, 0)
  const { width, height } = geometry
  const glow = ctx.createRadialGradient(0, -height * 0.48, 8, 0, -height * 0.48, 92)
  glow.addColorStop(0, 'rgba(152, 220, 203, 0.10)')
  glow.addColorStop(1, 'rgba(152, 220, 203, 0)')
  ctx.fillStyle = glow; ctx.fillRect(-96, -height - 52, 192, 192)
  const fill = ctx.createLinearGradient(0, -height, 0, 5)
  fill.addColorStop(0, 'rgba(221, 216, 248, 0.78)')
  fill.addColorStop(0.45, 'rgba(174, 211, 223, 0.40)')
  fill.addColorStop(1, 'rgba(152, 220, 203, 0.18)')
  path(ctx, geometry.localBell)
  ctx.fillStyle = fill; ctx.fill()
  ctx.strokeStyle = 'rgba(221, 237, 231, 0.66)'; ctx.lineWidth = 1.1; ctx.stroke()
  ctx.strokeStyle = 'rgba(221, 237, 231, 0.20)'; ctx.lineWidth = 0.75
  for (const u of [-0.52, 0, 0.52]) {
    ctx.beginPath(); ctx.moveTo(0, -height * 0.94)
    ctx.quadraticCurveTo(u * width * 1.15, -height * 0.59, u * width, -5); ctx.stroke()
  }
  ctx.beginPath(); ctx.moveTo(-width * 0.88, -4)
  ctx.quadraticCurveTo(0, -13, width * 0.88, -4)
  ctx.strokeStyle = 'rgba(152, 220, 203, 0.78)'; ctx.lineWidth = 1.6; ctx.stroke()
  ctx.restore()
}

export function layoutObstacleFromState(state: JellyfishState, scale = 1) {
  const geometry = getJellyfishGeometry(state, scale)
  return {
    cx: geometry.origin.x - geometry.down.x * geometry.height * 0.5 * geometry.effectiveScale,
    cy: geometry.origin.y - geometry.down.y * geometry.height * 0.5 * geometry.effectiveScale,
    r: (geometry.width + 6) * geometry.effectiveScale,
  }
}

function polygonInterval(points: readonly Point[], top: number, bottom: number, pad: number): Interval | null {
  let left = Infinity, right = -Infinity
  const bandTop = top - pad, bandBottom = bottom + pad
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!
    if (a.y >= bandTop && a.y <= bandBottom) { left = Math.min(left, a.x); right = Math.max(right, a.x) }
    for (const y of [bandTop, bandBottom]) {
      if ((a.y <= y && b.y >= y || b.y <= y && a.y >= y) && Math.abs(b.y - a.y) > 1e-8) {
        const x = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)
        left = Math.min(left, x); right = Math.max(right, x)
      }
    }
  }
  return Number.isFinite(left) ? { left: left - pad, right: right + pad } : null
}

export function blockedIntervalsForLayout(state: JellyfishState, top: number, bottom: number, scale = 1): Interval[] {
  if (state.depth >= 0.72) return []
  const geometry = getJellyfishGeometry(state, scale)
  const parts: Interval[] = []
  for (const outline of [geometry.bell, ...geometry.tentacles]) {
    const interval = polygonInterval(outline, top, bottom, 3 + scale * 2)
    if (interval) parts.push(interval)
  }
  return mergeIntervals(parts)
}
