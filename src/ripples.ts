import { mergeIntervals, type Interval } from './intervals.ts'

type Point = { x: number; y: number }
export type RippleKind = 'dive' | 'surface'
export type Ripple = {
  x: number; y: number; age: number; kind: RippleKind; maxRadius: number; impactRadius?: number
  depthAtImpact?: number; depth?: number; depthShift?: Point
}
export type PressureFront = { x: number; y: number; radius: number; outerRadius: number; aspectY: number; opacity: number }
const SPLASH_TIME = 0.58
const WAVE_START = 0.18
const TRAVEL_TIME = 0.95
const STAGGER = 0.20
const TRAIN_END = WAVE_START + STAGGER + TRAVEL_TIME
const RECEDE_TIME = 0.28
const DURATION = TRAIN_END + RECEDE_TIME
const ASPECT_Y = 0.56
const DROP_ANGLES = [0.14, 0.63, 1.07, 1.31, 1.62, 1.84].map(value => value * Math.PI)

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }
function impactSize(ripple: Ripple): number {
  return Math.max(0, Math.min(ripple.impactRadius ?? Math.min(46, ripple.maxRadius * 0.52), ripple.maxRadius * 0.88))
}
export function getRippleMaxFootprintRadius(maxRadius: number): number { return maxRadius + 8 }

export function pushRipple(list: Ripple[], x: number, y: number, kind: RippleKind,
  maxActive: number, maxRadius = 100, impactRadius?: number): Ripple {
  const ripple: Ripple = { x, y, kind, maxRadius, impactRadius, age: 0 }
  list.push(ripple)
  while (list.length > maxActive) list.shift()
  return ripple
}
export function stepRipples(list: Ripple[], dt: number, speed = 1): void {
  const elapsed = Math.max(0, dt) * Math.max(0, speed)
  for (let i = list.length - 1; i >= 0; i--) {
    list[i]!.age += elapsed
    if (list[i]!.age >= DURATION) list.splice(i, 1)
  }
}

function ellipsePoints(x: number, y: number, radius: number, aspect: number, start = 0, end = Math.PI * 2, count = 64): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = start + (end - start) * i / count
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius * aspect }
  })
}
function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t
  return { x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y }
}
function dropletPoints(x: number, y: number, vx: number, vy: number, size: number): Point[] {
  const speed = Math.hypot(vx, vy) || 1
  const dx = vx / speed, dy = vy / speed, nx = -dy, ny = dx
  const tail = { x: x - dx * size * 2.8, y: y - dy * size * 2.8 }
  const head = { x: x + dx * size, y: y + dy * size }
  const left = { x: x + nx * size * 1.6, y: y + ny * size * 1.6 }
  const right = { x: x - nx * size * 1.6, y: y - ny * size * 1.6 }
  const points: Point[] = []
  for (let i = 0; i <= 12; i++) points.push(cubic(tail, left, left, head, i / 12))
  for (let i = 1; i <= 12; i++) points.push(cubic(head, right, right, tail, i / 12))
  return points
}

/** A solid center, raised water crown, and ballistic droplets share their painted/layout outlines. */
function computeSplashGeometry(ripple: Ripple) {
  if (ripple.age < 0 || ripple.age >= SPLASH_TIME) return null
  const size = impactSize(ripple)
  if (size < 1) return null
  const t = ripple.age / SPLASH_TIME
  const opacity = 1 - smoothstep((ripple.age - 0.26) / 0.32)
  const radius = size * (0.80 + 0.28 * Math.sin(Math.PI * t))
  const lift = size * 0.50 * Math.sin(Math.PI * t) ** 1.25 * (ripple.kind === 'surface' ? 0.75 : 1)
  const phase = ripple.x * 0.01 + ripple.y * 0.008
  const crownPoint = (angle: number): Point => {
    const lobe = Math.max(0, Math.sin(angle * 5 + phase)) ** 3
    const depth = Math.sin(angle) > 0 ? 0.62 : 1
    return { x: ripple.x + Math.cos(angle) * radius,
      y: ripple.y + Math.sin(angle) * radius * 0.50 - lift * lobe * depth }
  }
  const crown = Array.from({ length: 129 }, (_, i) => crownPoint(i * Math.PI / 64))
  // The bell changes rendered position with depth; keep its center behind the water
  // without moving the impact crown or the outgoing waves after the cursor.
  const depthDelta = (ripple.depth ?? ripple.depthAtImpact ?? 0) - (ripple.depthAtImpact ?? 0)
  const coreX = ripple.x + (ripple.depthShift?.x ?? 0) * depthDelta * 0.65
  const coreY = ripple.y - size * 0.035 + (ripple.depthShift?.y ?? 0) * depthDelta * 0.65
  const core = ellipsePoints(coreX, coreY, radius * 0.77, 0.45)
  const lip = [...Array.from({ length: 65 }, (_, i) => crownPoint(i * Math.PI / 64)),
    ...ellipsePoints(coreX, coreY, radius * 0.77, 0.45, Math.PI, 0)]
  const foam = taperedArc(coreX, coreY, radius * 0.78, 0.45, Math.PI * 0.06, Math.PI * 0.94, 2.3)
  const droplets: { points: Point[]; opacity: number }[] = []
  const flight = ripple.age - 0.04
  if (flight > 0 && flight < 0.46) {
    for (let i = 0; i < DROP_ANGLES.length; i++) {
      const angle = DROP_ANGLES[i]!
      const dropSize = (2.2 + i % 3 * 0.45) * size / 46
      const originX = Math.cos(angle) * size * 0.78
      // Reserve the droplet outline and its text padding within the fitted water
      // footprint. A larger crown gets a quieter sideways spray on narrow screens.
      const maxTravel = Math.max(0, ripple.maxRadius + 5 - dropSize * 3 - Math.abs(originX))
      const launchVx = Math.cos(angle) * size * (1.55 + i * 0.08)
      const vx = Math.sign(launchVx) * Math.min(Math.abs(launchVx), maxTravel / 0.46)
      const launchY = Math.sin(angle) * size * 0.48 - size * (1.42 + i % 3 * 0.10)
      const gravity = size * 7.5
      const x = ripple.x + originX + vx * flight
      const y = ripple.y + Math.sin(angle) * size * 0.39 + launchY * flight + gravity * flight * flight * 0.5
      const vy = launchY + gravity * flight
      droplets.push({ points: dropletPoints(x, y, vx, vy, dropSize),
        opacity: smoothstep(flight / 0.035) * (1 - smoothstep((flight - 0.30) / 0.16)) })
    }
  }
  const bounds = [crown, core, lip, foam, ...droplets.map(drop => drop.points)].map(points => ({
    left: Math.min(...points.map(point => point.x)) - 3,
    right: Math.max(...points.map(point => point.x)) + 3,
    top: Math.min(...points.map(point => point.y)) - 3,
    bottom: Math.max(...points.map(point => point.y)) + 3,
  }))
  return { crown, core, lip, foam, droplets, opacity, size, bounds }
}

type SplashGeometry = ReturnType<typeof computeSplashGeometry>
const splashCache = new WeakMap<Ripple, { age: number; x: number; y: number; maxRadius: number;
  impactRadius: number | undefined; kind: RippleKind; depthAtImpact: number | undefined;
  depth: number | undefined; shiftX: number | undefined; shiftY: number | undefined; geometry: SplashGeometry }>()
export function getSplashGeometry(ripple: Ripple): SplashGeometry {
  const cached = splashCache.get(ripple)
  if (cached && cached.age === ripple.age && cached.x === ripple.x && cached.y === ripple.y &&
    cached.maxRadius === ripple.maxRadius && cached.impactRadius === ripple.impactRadius && cached.kind === ripple.kind &&
    cached.depthAtImpact === ripple.depthAtImpact && cached.depth === ripple.depth &&
    cached.shiftX === ripple.depthShift?.x && cached.shiftY === ripple.depthShift?.y) return cached.geometry
  const geometry = computeSplashGeometry(ripple)
  splashCache.set(ripple, { age: ripple.age, x: ripple.x, y: ripple.y, maxRadius: ripple.maxRadius,
    impactRadius: ripple.impactRadius, kind: ripple.kind, depthAtImpact: ripple.depthAtImpact,
    depth: ripple.depth, shiftX: ripple.depthShift?.x, shiftY: ripple.depthShift?.y, geometry })
  return geometry
}

export function getRippleFronts(ripple: Ripple): PressureFront[] {
  const fronts: PressureFront[] = []
  const originRadius = impactSize(ripple) * 0.84
  for (let i = 0; i < 2; i++) {
    const age = ripple.age - WAVE_START - i * STAGGER
    if (age <= 0 || age >= TRAVEL_TIME) continue
    const t = age / TRAVEL_TIME
    const opacity = smoothstep(age / 0.06) * (1 - t) ** 0.85 * (i === 0 ? 0.92 : 0.52)
    if (opacity < 0.008) continue
    const radius = originRadius + (ripple.maxRadius * (1 - i * 0.10) - originRadius) * (1 - (1 - t) ** 1.6)
    fronts.push({ x: ripple.x, y: ripple.y, radius, outerRadius: radius + 8, aspectY: ASPECT_Y, opacity })
  }
  return fronts
}

export function getRippleFootprint(ripple: Ripple) {
  if (ripple.age >= DURATION) return null
  const t = clamp01((ripple.age - WAVE_START) / TRAVEL_TIME)
  const radius = impactSize(ripple) * 1.12 + (ripple.maxRadius - impactSize(ripple) * 1.12) * (1 - (1 - t) ** 1.6)
  const release = 1 - smoothstep((ripple.age - TRAIN_END) / RECEDE_TIME)
  const outerRadius = (radius + 8) * release
  if (outerRadius <= 0) return null
  return { x: ripple.x, y: ripple.y, outerRadius, aspectY: ASPECT_Y, release }
}
export function blockedIntervalsForPressureFront(front: Pick<PressureFront, 'x' | 'y' | 'outerRadius' | 'aspectY'>,
  top: number, bottom: number): Interval[] {
  const nearY = Math.min(Math.max(front.y, top), bottom)
  const dy = (nearY - front.y) / front.aspectY
  if (Math.abs(dy) >= front.outerRadius) return []
  const half = Math.sqrt(Math.max(0, front.outerRadius ** 2 - dy ** 2))
  return [{ left: front.x - half, right: front.x + half }]
}
export function blockedIntervalsForRippleBands(ripples: readonly Ripple[], top: number, bottom: number): Interval[] {
  const intervals: Interval[] = []
  for (const ripple of ripples) {
    const footprint = getRippleFootprint(ripple)
    if (footprint) intervals.push(...blockedIntervalsForPressureFront(footprint, top, bottom))
    const splash = getSplashGeometry(ripple)
    if (splash) for (const bounds of splash.bounds) {
      if (bottom >= bounds.top && top <= bounds.bottom) intervals.push({ left: bounds.left, right: bounds.right })
    }
  }
  return mergeIntervals(intervals)
}

function taperedArc(x: number, y: number, radius: number, aspect: number, start: number, end: number, width: number): Point[] {
  const outer: Point[] = [], inner: Point[] = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, angle = start + (end - start) * t
    const half = Math.sin(Math.PI * t) ** 0.7 * width * 0.5
    outer.push({ x: x + Math.cos(angle) * (radius + half), y: y + Math.sin(angle) * (radius + half) * aspect })
    inner.push({ x: x + Math.cos(angle) * (radius - half), y: y + Math.sin(angle) * (radius - half) * aspect })
  }
  return [...outer, ...inner.reverse()]
}
function path(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath(); ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y)
  ctx.closePath()
}
function fill(ctx: CanvasRenderingContext2D, points: readonly Point[], color: string | CanvasGradient, opacity: number): void {
  path(ctx, points); ctx.fillStyle = color; ctx.globalAlpha = opacity; ctx.fill()
}

/** Compact, tapered reflections on a shallow water plane, rather than complete outline circles. */
export function drawRipples(ctx: CanvasRenderingContext2D, ripples: readonly Ripple[]): void {
  ctx.save()
  for (const ripple of ripples) for (const front of getRippleFronts(ripple)) {
    const back = taperedArc(front.x, front.y, front.radius, ASPECT_Y, Math.PI * 1.04, Math.PI * 1.94, 1.7)
    const near = taperedArc(front.x, front.y, front.radius, ASPECT_Y, Math.PI * 0.06, Math.PI * 0.94, 2.4)
    fill(ctx, back, '#bad8d3', front.opacity * 0.65)
    fill(ctx, near, '#d2e8df', front.opacity)
    const trough = taperedArc(front.x, front.y + 1.3, front.radius - 1.4, ASPECT_Y, Math.PI * 0.06, Math.PI * 0.94, 1.2)
    fill(ctx, trough, '#041d2a', front.opacity * 0.65)
  }
  ctx.restore()
}

/** Painted after the creature, so the opaque splash center covers the submerging bell. */
export function drawSplash(ctx: CanvasRenderingContext2D, ripples: readonly Ripple[]): void {
  ctx.save()
  for (const ripple of ripples) {
    const splash = getSplashGeometry(ripple)
    if (splash === null) continue
    const material = ctx.createLinearGradient(ripple.x, ripple.y - splash.size, ripple.x, ripple.y + splash.size * 0.5)
    material.addColorStop(0, '#8dc9c6'); material.addColorStop(0.48, '#3e7f8a'); material.addColorStop(1, '#123d50')
    fill(ctx, splash.crown, material, splash.opacity)
    fill(ctx, splash.core, '#0a2836', splash.opacity)
    fill(ctx, splash.lip, material, splash.opacity)
    fill(ctx, splash.foam, '#d6eee4', splash.opacity * 0.84)
    path(ctx, splash.crown); ctx.strokeStyle = '#a7dcd2'; ctx.lineWidth = 1.1
    ctx.globalAlpha = splash.opacity * 0.72; ctx.stroke()
    for (const drop of splash.droplets) {
      fill(ctx, drop.points, '#b3dfd6', drop.opacity)
      ctx.strokeStyle = '#e3f5ec'; ctx.lineWidth = 0.7; ctx.globalAlpha = drop.opacity * 0.6; ctx.stroke()
    }
  }
  ctx.restore()
}
