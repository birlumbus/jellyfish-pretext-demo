import './style.css'
import {
  createJellyfishState,
  drawJellyfish,
  layoutObstacleFromState,
  stepJellyfish,
} from './jellyfish'
import { drawRipples, layoutRadiusForRippleRing, pushRipple, removeExpiredRipples, type Ripple } from './ripples'
import {
  BODY_FONT,
  drawLines,
  getPreparedBody,
  layoutLinesForObstacle,
} from './text-layout'

/** After the visual ripple finishes expanding, wait this long before text carve-out *starts* receding. */
const WAVE_TEXT_POST_RIPPLE_DELAY_MS = 250
/**
 * Duration of the recede animation alone (does **not** include the post-ripple delay above).
 * Easing is ease-in-out so motion is spread across the full window (ease-out-only felt much faster).
 */
const WAVE_TEXT_RECEDE_DURATION_MS = 2400

/** Max completed wave-text recede animations at once (3rd overlapping cycle drops the oldest). */
const MAX_WAVE_TEXT_RECDE_SLOTS = 2

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

type WaitRecedeState = {
  cx: number
  cy: number
  ringLayoutR: [number, number, number]
  phase: 'wait' | 'receding'
  tWaitEnd: number
  tRecedeStart: number
  tRecedeEnd: number
}

/** `sessionT0` when this recede came from a surface ripple (for live-band exclusion). */
type TrackedRecede = WaitRecedeState & { sessionT0?: number }

function scaleFromWaitRecede(s: WaitRecedeState, clock: number): number {
  if (s.phase === 'wait') return 1
  const u = (clock - s.tRecedeStart) / (s.tRecedeEnd - s.tRecedeStart)
  if (u >= 1) return 0
  return 1 - easeInOutCubic(u)
}

function maxRing(r: readonly [number, number, number]): number {
  return Math.max(r[0], r[1], r[2])
}

const textCanvasEl = document.getElementById('text-canvas')
const jellyCanvasEl = document.getElementById('jelly-canvas')
if (!(textCanvasEl instanceof HTMLCanvasElement)) throw new Error('#text-canvas missing')
if (!(jellyCanvasEl instanceof HTMLCanvasElement)) throw new Error('#jelly-canvas missing')
const textCanvas = textCanvasEl
const jellyCanvas = jellyCanvasEl

const textCtx = textCanvas.getContext('2d')
const jellyCtx = jellyCanvas.getContext('2d')
if (textCtx === null || jellyCtx === null) throw new Error('2d context unavailable')
const text2d = textCtx
const jelly2d = jellyCtx

const LINE_HEIGHT = 30
const MARGIN = 28

let dpr = window.devicePixelRatio || 1
let width = 0
let height = 0

let pointerX = innerWidth * 0.5
let pointerY = innerHeight * 0.45
const jelly = createJellyfishState(pointerX, pointerY)

/** Underwater visual mode (dim jelly); text ignores jelly, only waves carve copy. */
let underwater = false

/** While the dive ripple is animating — max ring radii for layout. */
type DiveWaveImprint = {
  x: number
  y: number
  ringLayoutR: [number, number, number]
}
let diveWaveImprint: DiveWaveImprint | null = null

/** While the surface ripple is animating — max radii (surfaced). */
type SurfaceTextImprint = {
  cx: number
  cy: number
  ringLayoutR: [number, number, number]
  sessionT0: number
}
let surfaceTextImprint: SurfaceTextImprint | null = null

/**
 * FIFO queue of wait/recede phases after a ripple’s visual ends. Capped so a 3rd quick cycle
 * drops the oldest; new clicks do not clear in-progress recedes.
 */
let waveTextRedeces: TrackedRecede[] = []

function pushWaveTextRecede(item: TrackedRecede): void {
  waveTextRedeces.push(item)
  while (waveTextRedeces.length > MAX_WAVE_TEXT_RECDE_SLOTS) {
    waveTextRedeces.shift()
  }
}

const ripples: Ripple[] = []
const MAX_RIPPLES = 2

function updateDiveWaveImprintFromRipples(clock: number): void {
  if (!underwater || diveWaveImprint === null) return
  for (const r of ripples) {
    if (r.kind !== 'dive') continue
    const age = (clock - r.t0) / 1000
    if (age < 0) continue
    for (let k = 0; k < 3; k++) {
      const lr = layoutRadiusForRippleRing(age, k)
      if (lr === null) continue
      diveWaveImprint.ringLayoutR[k] = Math.max(diveWaveImprint.ringLayoutR[k], lr)
    }
  }
}

function updateSurfaceTextImprintFromRipples(clock: number): void {
  if (underwater || surfaceTextImprint === null) return
  const r = ripples.find(ripple => ripple.kind === 'surface' && ripple.t0 === surfaceTextImprint!.sessionT0)
  if (r === undefined) return
  const age = (clock - r.t0) / 1000
  if (age < 0) return
  for (let k = 0; k < 3; k++) {
    const lr = layoutRadiusForRippleRing(age, k)
    if (lr === null) continue
    surfaceTextImprint.ringLayoutR[k] = Math.max(surfaceTextImprint.ringLayoutR[k], lr)
  }
}

function advanceWaitRecedeState(clock: number, state: WaitRecedeState | null): WaitRecedeState | null {
  if (state === null) return null
  if (state.phase === 'wait' && clock >= state.tWaitEnd) {
    return {
      ...state,
      phase: 'receding',
      tRecedeStart: clock,
      tRecedeEnd: clock + WAVE_TEXT_RECEDE_DURATION_MS,
    }
  }
  if (state.phase === 'receding' && clock >= state.tRecedeEnd) {
    return null
  }
  return state
}

function advanceTrackedRecede(clock: number, s: TrackedRecede): TrackedRecede | null {
  const next = advanceWaitRecedeState(clock, s)
  if (next === null) return null
  return { ...next, sessionT0: s.sessionT0 }
}

/** After ripples are culled: start auto-recede timers when animated ripples are gone. */
function transitionWaveTextAfterRipplesRemoved(clock: number): void {
  if (underwater && diveWaveImprint !== null) {
    const hasDiveRipple = ripples.some(r => r.kind === 'dive')
    if (!hasDiveRipple && maxRing(diveWaveImprint.ringLayoutR) > 0) {
      pushWaveTextRecede({
        cx: diveWaveImprint.x,
        cy: diveWaveImprint.y,
        ringLayoutR: [...diveWaveImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
      })
      diveWaveImprint = null
    }
  }

  if (!underwater && surfaceTextImprint !== null) {
    const t0 = surfaceTextImprint.sessionT0
    const hasSurfaceRipple = ripples.some(r => r.kind === 'surface' && r.t0 === t0)
    if (!hasSurfaceRipple && maxRing(surfaceTextImprint.ringLayoutR) > 0) {
      pushWaveTextRecede({
        cx: surfaceTextImprint.cx,
        cy: surfaceTextImprint.cy,
        ringLayoutR: [...surfaceTextImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
        sessionT0: t0,
      })
      surfaceTextImprint = null
    }
  }
}

type WaveMemoryPayload = {
  memories: { cx: number; cy: number; ringLayoutR: [number, number, number]; scale: number }[]
}

function computeWaveMemory(clock: number): WaveMemoryPayload | undefined {
  const memories: WaveMemoryPayload['memories'] = []

  for (const tr of waveTextRedeces) {
    const sc = scaleFromWaitRecede(tr, clock)
    if (sc > 0) {
      memories.push({
        cx: tr.cx,
        cy: tr.cy,
        ringLayoutR: tr.ringLayoutR,
        scale: sc,
      })
    }
  }

  if (underwater && diveWaveImprint !== null) {
    memories.push({
      cx: diveWaveImprint.x,
      cy: diveWaveImprint.y,
      ringLayoutR: diveWaveImprint.ringLayoutR,
      scale: 1,
    })
  }

  if (!underwater && surfaceTextImprint !== null) {
    memories.push({
      cx: surfaceTextImprint.cx,
      cy: surfaceTextImprint.cy,
      ringLayoutR: surfaceTextImprint.ringLayoutR,
      scale: 1,
    })
  }

  return memories.length > 0 ? { memories } : undefined
}

/**
 * Omit surface ripples whose carve-out is tracked in memory (active imprint or matching recede slot).
 */
function ripplesForTextLayout(): Ripple[] {
  const surfaceT0s = new Set<number>()
  if (surfaceTextImprint !== null) {
    surfaceT0s.add(surfaceTextImprint.sessionT0)
  }
  for (const tr of waveTextRedeces) {
    if (tr.sessionT0 !== undefined) {
      surfaceT0s.add(tr.sessionT0)
    }
  }
  if (surfaceT0s.size === 0) return ripples
  return ripples.filter(r => !(r.kind === 'surface' && surfaceT0s.has(r.t0)))
}

addEventListener('click', () => {
  const { cx, cy } = layoutObstacleFromState(jelly)
  const clock = performance.now()

  if (!underwater) {
    if (surfaceTextImprint !== null && maxRing(surfaceTextImprint.ringLayoutR) > 0) {
      pushWaveTextRecede({
        cx: surfaceTextImprint.cx,
        cy: surfaceTextImprint.cy,
        ringLayoutR: [...surfaceTextImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
        sessionT0: surfaceTextImprint.sessionT0,
      })
    }
    surfaceTextImprint = null

    pushRipple(ripples, cx, cy, 'dive', MAX_RIPPLES)
    underwater = true
    diveWaveImprint = { x: cx, y: cy, ringLayoutR: [0, 0, 0] }
  } else {
    if (diveWaveImprint !== null && maxRing(diveWaveImprint.ringLayoutR) > 0) {
      pushWaveTextRecede({
        cx: diveWaveImprint.x,
        cy: diveWaveImprint.y,
        ringLayoutR: [...diveWaveImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
      })
    }
    diveWaveImprint = null

    pushRipple(ripples, cx, cy, 'surface', MAX_RIPPLES)
    const last = ripples[ripples.length - 1]
    const surfaceT0 = last !== undefined ? last.t0 : clock

    underwater = false

    surfaceTextImprint = {
      cx,
      cy,
      ringLayoutR: [0, 0, 0],
      sessionT0: surfaceT0,
    }
  }
})

function resize(): void {
  dpr = window.devicePixelRatio || 1
  width = innerWidth
  height = innerHeight
  textCanvas.width = Math.floor(width * dpr)
  textCanvas.height = Math.floor(height * dpr)
  textCanvas.style.width = `${width}px`
  textCanvas.style.height = `${height}px`
  jellyCanvas.width = Math.floor(width * dpr)
  jellyCanvas.height = Math.floor(height * dpr)
  jellyCanvas.style.width = `${width}px`
  jellyCanvas.style.height = `${height}px`
  text2d.setTransform(dpr, 0, 0, dpr, 0, 0)
  jelly2d.setTransform(dpr, 0, 0, dpr, 0, 0)
}

addEventListener('resize', resize)
addEventListener('pointermove', e => {
  pointerX = e.clientX
  pointerY = e.clientY
})

resize()

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  const clock = performance.now()

  stepJellyfish(jelly, pointerX, pointerY, dt)

  updateDiveWaveImprintFromRipples(clock)
  updateSurfaceTextImprintFromRipples(clock)

  removeExpiredRipples(ripples, clock)

  transitionWaveTextAfterRipplesRemoved(clock)

  waveTextRedeces = waveTextRedeces.map(tr => advanceTrackedRecede(clock, tr)).filter((tr): tr is TrackedRecede => tr !== null)

  const waveMemory = computeWaveMemory(clock)

  const prepared = getPreparedBody()
  const lines = layoutLinesForObstacle(prepared, width, height, MARGIN, LINE_HEIGHT, jelly, {
    ripples: ripplesForTextLayout(),
    nowMs: clock,
    omitJellyObstacle: underwater,
    waveMemory,
  })

  text2d.fillStyle = '#0a1628'
  text2d.fillRect(0, 0, width, height)

  drawRipples(text2d, ripples, clock)

  drawLines(text2d, lines)

  jelly2d.clearRect(0, 0, width, height)
  drawJellyfish(jelly2d, jelly, { underwater })

  requestAnimationFrame(frame)
}

void document.fonts.load(BODY_FONT).finally(() => {
  getPreparedBody()
  requestAnimationFrame(t => {
    last = t
    requestAnimationFrame(frame)
  })
})
