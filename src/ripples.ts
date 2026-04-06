import { circleBlockedIntervalForBand, mergeIntervals, type Interval } from './intervals'

export type RippleKind = 'dive' | 'surface'

export type Ripple = {
  x: number
  y: number
  t0: number
  kind: RippleKind
  /** Per-event angle offset so successive ripples don’t look identical. */
  rot0: number
}

const DURATION_S = 1.55
/** Outer travel distance (px) for the leading wave. */
const RIPPLE_MAX_R = 168
/** Three wave fronts, each delayed so they read as separate rings moving out. */
const RINGS = 3
const RING_STAGGER_S = 0.22
const SEGMENTS = 96
/** Extra radius for text carve-out so copy clears the wavy stroke (layout uses smooth circles). */
const RIPPLE_LAYOUT_PAD = 18

/** Layout radius (base + pad) for a ring at this age, or null if the ring has not started. */
export function layoutRadiusForRippleRing(ageSeconds: number, ringIndex: number): number | null {
  const base = ringBaseRadiusForRipple(ageSeconds, ringIndex)
  if (base === null) return null
  return base + RIPPLE_LAYOUT_PAD
}

/** Ring mean radius in px, or null if that ring has not started yet. */
export function ringBaseRadiusForRipple(ageSeconds: number, ringIndex: number): number | null {
  const ringAge = ageSeconds - ringIndex * RING_STAGGER_S
  if (ringAge <= 0) return null
  const ringT = Math.min(1, ringAge / (DURATION_S * 0.82))
  return Math.max(5, ringT * RIPPLE_MAX_R * (1 + ringIndex * 0.07))
}

/**
 * Horizontal blocked intervals for one text line band: expanding ripple rings as smooth circles.
 */
export function blockedIntervalsForRippleBands(
  ripples: readonly Ripple[],
  nowMs: number,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  const parts: Interval[] = []
  for (const r of ripples) {
    const age = (nowMs - r.t0) / 1000
    if (age >= DURATION_S || age < 0) continue

    for (let k = 0; k < RINGS; k++) {
      const layoutR = layoutRadiusForRippleRing(age, k)
      if (layoutR === null) continue
      const block = circleBlockedIntervalForBand(r.x, r.y, layoutR, bandTop, bandBottom)
      if (block) parts.push(block)
    }
  }
  return mergeIntervals(parts)
}

/**
 * Blocked intervals from stored max ring radii (layout px), scaled for recede animation.
 */
export function blockedIntervalsForWaveMemory(
  cx: number,
  cy: number,
  ringLayoutR: readonly [number, number, number],
  scale: number,
  bandTop: number,
  bandBottom: number,
): Interval[] {
  if (scale <= 0) return []
  const parts: Interval[] = []
  for (let k = 0; k < RINGS; k++) {
    const r = ringLayoutR[k]! * scale
    if (r <= 0) continue
    const block = circleBlockedIntervalForBand(cx, cy, r, bandTop, bandBottom)
    if (block) parts.push(block)
  }
  return mergeIntervals(parts)
}

/**
 * Append a ripple and drop the oldest if more than `maxActive` should be playing.
 */
export function pushRipple(
  list: Ripple[],
  x: number,
  y: number,
  kind: RippleKind,
  maxActive: number,
): void {
  list.push({
    x,
    y,
    t0: performance.now(),
    kind,
    rot0: Math.random() * Math.PI * 2,
  })
  while (list.length > maxActive) {
    list.shift()
  }
}

export function removeExpiredRipples(list: Ripple[], nowMs: number): void {
  const cutoff = nowMs - DURATION_S * 1000
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.t0 < cutoff) {
      list.splice(i, 1)
    }
  }
}

function strokeWavyRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  baseR: number,
  rot0: number,
  ringIndex: number,
  age: number,
  alpha: number,
  kind: RippleKind,
): void {
  const phase = rot0 + ringIndex * 1.17
  // Wobble scales gently with radius so small rings stay subtle, large ones feel fluid.
  const a1 = 3.2 + baseR * 0.038
  const a2 = 1.6 + baseR * 0.022
  const a3 = 0.9 + baseR * 0.012
  const n1 = 4 + ringIndex * 0.4
  const n2 = 9 + ringIndex * 0.6
  const n3 = 15
  const drift = age * 2.4 + ringIndex * 0.35

  ctx.beginPath()
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Math.PI * 2
    const wobble =
      a1 * Math.sin(n1 * theta + phase + drift * 0.15) +
      a2 * Math.sin(n2 * theta - phase * 1.3 + drift * 0.22) +
      a3 * Math.sin(n3 * theta + drift)
    const rr = Math.max(2.5, baseR + wobble)
    const px = cx + Math.cos(theta) * rr
    const py = cy + Math.sin(theta) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()

  if (kind === 'dive') {
    ctx.strokeStyle = `rgba(120, 220, 255, ${alpha})`
  } else {
    ctx.strokeStyle = `rgba(200, 250, 255, ${alpha})`
  }
  // Wider strokes read better on dark bg without pushing saturation.
  ctx.lineWidth = Math.max(2, 3.1 - ringIndex * 0.4)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

export function drawRipples(ctx: CanvasRenderingContext2D, list: Ripple[], nowMs: number): void {
  for (const r of list) {
    const age = (nowMs - r.t0) / 1000
    if (age >= DURATION_S || age < 0) continue

    const t = age / DURATION_S
    const fade = (1 - t) * (1 - t)

    for (let k = 0; k < RINGS; k++) {
      const radius = ringBaseRadiusForRipple(age, k)
      if (radius === null) continue

      const ringFade = fade * (1 - k * 0.12)
      const alpha = ringFade * (r.kind === 'dive' ? 0.64 : 0.58) * (1 - k * 0.08)

      strokeWavyRing(ctx, r.x, r.y, radius, r.rot0, k, age, alpha, r.kind)
    }
  }
}
