import type { Interval } from './intervals'
import { circleBlockedIntervalForBand, mergeIntervals } from './intervals'

/** Horizontal half-width of the bell rim in local “across” space. */
const BELL_RX = 52
/** Circle radius for pretext reflow (centered between base and apex). */
export const BODY_RADIUS_LAYOUT = 58
/** Extra horizontal padding around frond bounds (curves + stroke extend past control points). */
const FROND_LAYOUT_PAD_X = 7

const FROND_LENGTH = 48
/** Hard cap on |tip − anchor| so faster body motion does not stretch fronds beyond prior range. */
const FROND_MAX_ANCHOR_DIST = FROND_LENGTH + 18
const FROND_TOP_W = 8
const FROND_BOT_W = 15
const FROND_COUNT = 6
const FROND_UNDERLAP = 4
/** Keep frond anchors off the rim endpoints so end fronds sit under the dome, not past pL/pR. */
const RIM_U_INSET = 0.09

/** Damped spring: stiffness (1/s² scale) and damping coefficient (1/s). */
const FROND_STIFFNESS = 42
const FROND_DAMPING = 14
const SWAY_AMP = 2.6
/** Secondary motion from body drift (not raw cursor). */
const BODY_MOTION_INFLUENCE = 0.08

/** Target distance |apex − base| (side-view bell height). */
const BELL_REST_LENGTH = 68

/** Time constant (seconds) for low-pass cursor — smaller = tighter follow. */
const SMOOTH_CURSOR_TAU = 0.028

/** Cursor attraction on the apex (after smoothing). */
const K_ATTRACT = 86
const DRAG_LINEAR = 18
const DRAG_QUAD = 0.024
const MAX_SPEED_APEX = 340

/** Base follows apex through the “water”. */
const K_BASE = 50
const BASE_DRAG_LINEAR = 13
const BASE_DRAG_QUAD = 0.015
const MAX_SPEED_BASE = 260

/** After integration, nudge toward exact rest length (stable hinge). */
const LENGTH_RELAX = 0.42

/** Single peach fill for bell + fronds (no gradient). */
const FILL = 'rgb(255, 188, 138)'
const STROKE = 'rgba(120, 58, 28, 0.82)'
const STROKE_W = 1.2

type Frond = {
  tipX: number
  tipY: number
  vx: number
  vy: number
  phase: number
}

export type JellyfishState = {
  /** Rim center (oral side); fronds attach here. */
  x: number
  y: number
  baseVx: number
  baseVy: number
  /** Bell tip — pulled toward smoothed cursor. */
  apexX: number
  apexY: number
  apexVx: number
  apexVy: number
  fronds: Frond[]
  time: number
  /** Low-pass filtered pointer; apex tracks this. */
  smoothX: number
  smoothY: number
}

function bellBasis(apexX: number, apexY: number, baseX: number, baseY: number) {
  const dx = apexX - baseX
  const dy = apexY - baseY
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const vx = -uy
  const vy = ux
  return { ux, uy, vx, vy }
}

/** Rim point in world space; uParam ∈ [0,1] along the rim arc. */
function rimPointWorld(
  baseX: number,
  baseY: number,
  _ux: number,
  _uy: number,
  vx: number,
  vy: number,
  uParam: number,
): { x: number; y: number } {
  const lx = -BELL_RX + 2 * BELL_RX * uParam
  return {
    x: baseX + vx * lx,
    y: baseY + vy * lx,
  }
}

/** Unit tangent d/d u along the rim (increasing u = left → right). */
function rimTangentWorld(
  baseX: number,
  baseY: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  uParam: number,
): { x: number; y: number } {
  const e = 0.004
  const p0 = rimPointWorld(baseX, baseY, ux, uy, vx, vy, Math.max(0, uParam - e))
  const p1 = rimPointWorld(baseX, baseY, ux, uy, vx, vy, Math.min(1, uParam + e))
  let tx = p1.x - p0.x
  let ty = p1.y - p0.y
  const tlen = Math.hypot(tx, ty) || 1
  return { x: tx / tlen, y: ty / tlen }
}

function rimInwardNormalWorld(
  baseX: number,
  baseY: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  uParam: number,
): { x: number; y: number } {
  const e = 0.012
  const p0 = rimPointWorld(baseX, baseY, ux, uy, vx, vy, Math.max(0, uParam - e))
  const p1 = rimPointWorld(baseX, baseY, ux, uy, vx, vy, Math.min(1, uParam + e))
  let tx = p1.x - p0.x
  let ty = p1.y - p0.y
  const tlen = Math.hypot(tx, ty) || 1
  tx /= tlen
  ty /= tlen
  let nx = -ty
  let ny = tx
  const midX = baseX + ux * 40
  const midY = baseY + uy * 40
  if (nx * (midX - p0.x) + ny * (midY - p0.y) < 0) {
    nx = -nx
    ny = -ny
  }
  return { x: nx, y: ny }
}

export type FrondAttach = {
  x: number
  y: number
  /** Unit tangent along rim (left → right). */
  rimTx: number
  rimTy: number
}

function frondAttach(
  baseX: number,
  baseY: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  index: number,
): FrondAttach {
  const denom = Math.max(1, FROND_COUNT - 1)
  const span = 1 - 2 * RIM_U_INSET
  const u = RIM_U_INSET + span * (index / denom)
  const p = rimPointWorld(baseX, baseY, ux, uy, vx, vy, u)
  const n = rimInwardNormalWorld(baseX, baseY, ux, uy, vx, vy, u)
  const t = rimTangentWorld(baseX, baseY, ux, uy, vx, vy, u)
  return {
    x: p.x + n.x * FROND_UNDERLAP,
    y: p.y + n.y * FROND_UNDERLAP,
    rimTx: t.x,
    rimTy: t.y,
  }
}

export function createJellyfishState(cursorX: number, cursorY: number): JellyfishState {
  const fronds: Frond[] = []
  const { ux, uy, vx, vy } = bellBasis(cursorX, cursorY, cursorX, cursorY + BELL_REST_LENGTH)
  const downX = -ux
  const downY = -uy
  for (let i = 0; i < FROND_COUNT; i++) {
    const a = frondAttach(cursorX, cursorY + BELL_REST_LENGTH, ux, uy, vx, vy, i)
    fronds.push({
      tipX: a.x + downX * FROND_LENGTH,
      tipY: a.y + downY * FROND_LENGTH,
      vx: 0,
      vy: 0,
      phase: i * 1.9,
    })
  }
  return {
    x: cursorX,
    y: cursorY + BELL_REST_LENGTH,
    baseVx: 0,
    baseVy: 0,
    apexX: cursorX,
    apexY: cursorY,
    apexVx: 0,
    apexVy: 0,
    fronds,
    time: 0,
    smoothX: cursorX,
    smoothY: cursorY,
  }
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

export function stepJellyfish(
  state: JellyfishState,
  targetX: number,
  targetY: number,
  dt: number,
): void {
  state.time += dt

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

  const { ux: bux, uy: buy, vx: bvx, vy: bvy } = bellBasis(state.apexX, state.apexY, state.x, state.y)

  const swayT = state.time * 0.42
  const bodyDragX = baseVx * BODY_MOTION_INFLUENCE
  const bodyDragY = baseVy * BODY_MOTION_INFLUENCE * 0.45

  const downX = -bux
  const downY = -buy

  for (let i = 0; i < state.fronds.length; i++) {
    const f = state.fronds[i]!
    const anchor = frondAttach(state.x, state.y, bux, buy, bvx, bvy, i)

    const sway =
      Math.sin(swayT + f.phase) * SWAY_AMP +
      Math.sin(swayT * 0.62 + f.phase * 1.3) * (SWAY_AMP * 0.32)

    const tx = anchor.x + downX * FROND_LENGTH + anchor.rimTx * sway + bodyDragX
    const ty = anchor.y + downY * FROND_LENGTH + anchor.rimTy * sway * 0.12 + bodyDragY

    const ex = tx - f.tipX
    const ey = ty - f.tipY
    const axSpring = ex * FROND_STIFFNESS - f.vx * FROND_DAMPING
    const aySpring = ey * FROND_STIFFNESS - f.vy * FROND_DAMPING
    f.vx += axSpring * dt
    f.vy += aySpring * dt
    f.tipX += f.vx * dt
    f.tipY += f.vy * dt

    const fdx = f.tipX - anchor.x
    const fdy = f.tipY - anchor.y
    const fdist = Math.hypot(fdx, fdy)
    if (fdist > FROND_MAX_ANCHOR_DIST && fdist > 1e-6) {
      const s = FROND_MAX_ANCHOR_DIST / fdist
      f.tipX = anchor.x + fdx * s
      f.tipY = anchor.y + fdy * s
      const nx = fdx / fdist
      const ny = fdy / fdist
      const vrad = f.vx * nx + f.vy * ny
      if (vrad > 0) {
        f.vx -= nx * vrad
        f.vy -= ny * vrad
      }
    }
  }
}

type FrondPoly = {
  tl: { x: number; y: number }
  tr: { x: number; y: number }
  bl: { x: number; y: number }
  br: { x: number; y: number }
  midLx: number
  midLy: number
  midRx: number
  midRy: number
  tipX: number
  tipY: number
  bulge: number
}

function getFrondPoly(
  ax: number,
  ay: number,
  tipX: number,
  tipY: number,
  rimTx: number,
  rimTy: number,
  downX: number,
  downY: number,
): FrondPoly | null {
  const len = Math.hypot(tipX - ax, tipY - ay)
  if (len < 4) return null
  const px = rimTx
  const py = rimTy
  const ux = downX
  const uy = downY
  const wt = FROND_TOP_W * 0.5
  const wb = FROND_BOT_W * 0.5
  const bulge = Math.min(6.5, len * 0.13)
  const tlX = ax + px * wt
  const tlY = ay + py * wt
  const trX = ax - px * wt
  const trY = ay - py * wt
  const blX = tipX + px * wb
  const blY = tipY + py * wb
  const brX = tipX - px * wb
  const brY = tipY - py * wb
  const midLx = (tlX + blX) * 0.5 + ux * len * 0.08
  const midLy = (tlY + blY) * 0.5 + uy * len * 0.08
  const midRx = (trX + brX) * 0.5 + ux * len * 0.08
  const midRy = (trY + brY) * 0.5 + uy * len * 0.08
  return {
    tl: { x: tlX, y: tlY },
    tr: { x: trX, y: trY },
    bl: { x: blX, y: blY },
    br: { x: brX, y: brY },
    midLx,
    midLy,
    midRx,
    midRy,
    tipX,
    tipY,
    bulge,
  }
}

function frondBlockedIntervalForBand(
  p: FrondPoly,
  bandTop: number,
  bandBottom: number,
): Interval | null {
  const padY = 3
  const yMin =
    Math.min(p.tl.y, p.tr.y, p.bl.y, p.br.y, p.midLy, p.midRy, p.tipY, p.tipY + p.bulge) - padY
  const yMax =
    Math.max(p.tl.y, p.tr.y, p.bl.y, p.br.y, p.midLy, p.midRy, p.tipY, p.tipY + p.bulge) + padY
  if (bandBottom < yMin || bandTop > yMax) return null

  const xMin = Math.min(p.tl.x, p.tr.x, p.bl.x, p.br.x, p.midLx, p.midRx, p.tipX)
  const xMax = Math.max(p.tl.x, p.tr.x, p.bl.x, p.br.x, p.midLx, p.midRx, p.tipX)
  return {
    left: xMin - FROND_LAYOUT_PAD_X,
    right: xMax + FROND_LAYOUT_PAD_X,
  }
}

function drawPearFrondFill(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  tipX: number,
  tipY: number,
  rimTx: number,
  rimTy: number,
  downX: number,
  downY: number,
  upX: number,
  upY: number,
): void {
  const p = getFrondPoly(ax, ay, tipX, tipY, rimTx, rimTy, downX, downY)
  if (p === null) return

  ctx.beginPath()
  ctx.moveTo(p.tl.x, p.tl.y)
  ctx.quadraticCurveTo(p.midLx, p.midLy, p.bl.x, p.bl.y)
  ctx.quadraticCurveTo(p.tipX, p.tipY + p.bulge, p.br.x, p.br.y)
  ctx.quadraticCurveTo(p.midRx, p.midRy, p.tr.x, p.tr.y)
  const capX = (p.tl.x + p.tr.x) * 0.5 + upX * 1.0
  const capY = (p.tl.y + p.tr.y) * 0.5 + upY * 1.0
  ctx.quadraticCurveTo(capX, capY, p.tl.x, p.tl.y)
  ctx.closePath()

  ctx.fillStyle = FILL
  ctx.fill()
}

function bellArcParams(
  baseX: number,
  baseY: number,
  apexX: number,
  apexY: number,
): {
  pL: { x: number; y: number }
  pR: { x: number; y: number }
  mx: number
  my: number
  r: number
  angL: number
  angR: number
  anticlockwise: boolean
} {
  const { ux, uy, vx, vy } = bellBasis(apexX, apexY, baseX, baseY)
  const pL = rimPointWorld(baseX, baseY, ux, uy, vx, vy, 0)
  const pR = rimPointWorld(baseX, baseY, ux, uy, vx, vy, 1)
  const mx = (pL.x + pR.x) * 0.5
  const my = (pL.y + pR.y) * 0.5
  const r = BELL_RX
  const angL = Math.atan2(pL.y - my, pL.x - mx)
  const angR = Math.atan2(pR.y - my, pR.x - mx)
  const rx = pR.x - pL.x
  const ry = pR.y - pL.y
  const ax = apexX - mx
  const ay = apexY - my
  const cross = rx * ay - ry * ax
  const anticlockwise = cross > 0
  return { pL, pR, mx, my, r, angL, angR, anticlockwise }
}

/** Closed bell path for fill (dome + oral diameter). */
function drawBellBodyFill(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  apexX: number,
  apexY: number,
): void {
  const { pL, mx, my, r, angL, angR, anticlockwise } = bellArcParams(baseX, baseY, apexX, apexY)

  ctx.beginPath()
  ctx.moveTo(pL.x, pL.y)
  ctx.arc(mx, my, r, angL, angR, anticlockwise)
  ctx.lineTo(pL.x, pL.y)
  ctx.closePath()

  ctx.fillStyle = FILL
  ctx.fill()
}

/**
 * Outer stroke as two open subpaths so we do not draw along the oral rim over the
 * end fronds (that read as a seam between bell and tendrils).
 * 1) Dome arc pL → pR only.
 * 2) Outer frond loop from tr (right) down around tips and up to tl (left), no tl → pL.
 */
function appendJellyfishOutlinePath(
  ctx: CanvasRenderingContext2D,
  baseX: number,
  baseY: number,
  apexX: number,
  apexY: number,
  fronds: Frond[],
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  downX: number,
  downY: number,
): void {
  const { pL, mx, my, r, angL, angR, anticlockwise } = bellArcParams(baseX, baseY, apexX, apexY)
  const n = fronds.length

  const polys: (FrondPoly | null)[] = []
  for (let i = 0; i < n; i++) {
    const f = fronds[i]!
    const anchor = frondAttach(baseX, baseY, ux, uy, vx, vy, i)
    polys.push(
      getFrondPoly(anchor.x, anchor.y, f.tipX, f.tipY, anchor.rimTx, anchor.rimTy, downX, downY),
    )
  }

  if (n === 0 || polys.some(p => p === null)) {
    ctx.moveTo(pL.x, pL.y)
    ctx.arc(mx, my, r, angL, angR, anticlockwise)
    ctx.lineTo(pL.x, pL.y)
    ctx.closePath()
    return
  }

  ctx.moveTo(pL.x, pL.y)
  ctx.arc(mx, my, r, angL, angR, anticlockwise)

  const last = polys[n - 1]!
  ctx.moveTo(last.tr.x, last.tr.y)
  ctx.quadraticCurveTo(last.midRx, last.midRy, last.br.x, last.br.y)

  for (let i = n - 1; i >= 1; i--) {
    const pi = polys[i]!
    const prev = polys[i - 1]!
    ctx.quadraticCurveTo(pi.tipX, pi.tipY + pi.bulge, pi.bl.x, pi.bl.y)
    ctx.lineTo(prev.br.x, prev.br.y)
  }

  const p0 = polys[0]!
  ctx.quadraticCurveTo(p0.tipX, p0.tipY + p0.bulge, p0.bl.x, p0.bl.y)
  ctx.quadraticCurveTo(p0.midLx, p0.midLy, p0.tl.x, p0.tl.y)
}

export function drawJellyfish(
  ctx: CanvasRenderingContext2D,
  state: JellyfishState,
  options?: { underwater?: boolean },
): void {
  const { ux, uy, vx, vy } = bellBasis(state.apexX, state.apexY, state.x, state.y)
  const downX = -ux
  const downY = -uy

  ctx.save()
  if (options?.underwater) {
    ctx.filter = 'brightness(0.52) saturate(0.72) contrast(0.95)'
    ctx.globalAlpha = 0.9
  }

  for (let i = 0; i < state.fronds.length; i++) {
    const f = state.fronds[i]!
    const anchor = frondAttach(state.x, state.y, ux, uy, vx, vy, i)
    drawPearFrondFill(ctx, anchor.x, anchor.y, f.tipX, f.tipY, anchor.rimTx, anchor.rimTy, downX, downY, ux, uy)
  }

  drawBellBodyFill(ctx, state.x, state.y, state.apexX, state.apexY)

  ctx.beginPath()
  appendJellyfishOutlinePath(
    ctx,
    state.x,
    state.y,
    state.apexX,
    state.apexY,
    state.fronds,
    ux,
    uy,
    vx,
    vy,
    downX,
    downY,
  )
  ctx.strokeStyle = STROKE
  ctx.lineWidth = STROKE_W
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.restore()
}

export function layoutObstacleFromState(state: JellyfishState): { cx: number; cy: number; r: number } {
  const cx = (state.x + state.apexX) * 0.5
  const cy = (state.y + state.apexY) * 0.5
  return { cx, cy, r: BODY_RADIUS_LAYOUT }
}

/**
 * Horizontal blocked intervals for one text line band: bell (layout circle) plus each frond’s
 * footprint, merged so wrap carving sees a single obstacle region when shapes overlap.
 */
export function blockedIntervalsForLayout(
  state: JellyfishState,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const { cx, cy, r } = layoutObstacleFromState(state)
  const parts: Interval[] = []
  const bell = circleBlockedIntervalForBand(cx, cy, r, bandTop, bandBottom)
  if (bell) parts.push(bell)

  const { ux, uy, vx, vy } = bellBasis(state.apexX, state.apexY, state.x, state.y)
  const downX = -ux
  const downY = -uy

  for (let i = 0; i < state.fronds.length; i++) {
    const f = state.fronds[i]!
    const anchor = frondAttach(state.x, state.y, ux, uy, vx, vy, i)
    const poly = getFrondPoly(
      anchor.x,
      anchor.y,
      f.tipX,
      f.tipY,
      anchor.rimTx,
      anchor.rimTy,
      downX,
      downY,
    )
    if (poly === null) continue
    const fr = frondBlockedIntervalForBand(poly, bandTop, bandBottom)
    if (fr) parts.push(fr)
  }

  return mergeIntervals(parts)
}
