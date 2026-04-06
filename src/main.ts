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

/** After the dive ripple ends: hold full carve-out, then recede (still underwater). */
let underwaterWaveTextRecede: WaitRecedeState | null = null

/** While the surface ripple is animating — max radii (surfaced). */
type SurfaceTextImprint = {
  cx: number
  cy: number
  ringLayoutR: [number, number, number]
  sessionT0: number
}
let surfaceTextImprint: SurfaceTextImprint | null = null

/** After surface ripple ends: hold, then recede. */
let surfaceWaveTextRecede: (WaitRecedeState & { sessionT0: number }) | null = null

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

/** After ripples are culled: start auto-recede timers when animated ripples are gone. */
function transitionWaveTextAfterRipplesRemoved(clock: number): void {
  if (underwater && diveWaveImprint !== null && underwaterWaveTextRecede === null) {
    const hasDiveRipple = ripples.some(r => r.kind === 'dive')
    if (!hasDiveRipple && maxRing(diveWaveImprint.ringLayoutR) > 0) {
      underwaterWaveTextRecede = {
        cx: diveWaveImprint.x,
        cy: diveWaveImprint.y,
        ringLayoutR: [...diveWaveImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
      }
      diveWaveImprint = null
    }
  }

  if (!underwater && surfaceTextImprint !== null && surfaceWaveTextRecede === null) {
    const t0 = surfaceTextImprint.sessionT0
    const hasSurfaceRipple = ripples.some(r => r.kind === 'surface' && r.t0 === t0)
    if (!hasSurfaceRipple && maxRing(surfaceTextImprint.ringLayoutR) > 0) {
      surfaceWaveTextRecede = {
        cx: surfaceTextImprint.cx,
        cy: surfaceTextImprint.cy,
        ringLayoutR: [...surfaceTextImprint.ringLayoutR] as [number, number, number],
        phase: 'wait',
        tWaitEnd: clock + WAVE_TEXT_POST_RIPPLE_DELAY_MS,
        tRecedeStart: 0,
        tRecedeEnd: 0,
        sessionT0: t0,
      }
      surfaceTextImprint = null
    }
  }
}

type WaveMemoryPayload = {
  memories: { cx: number; cy: number; ringLayoutR: [number, number, number]; scale: number }[]
}

function computeWaveMemory(clock: number): WaveMemoryPayload | undefined {
  const memories: WaveMemoryPayload['memories'] = []

  if (underwater) {
    if (diveWaveImprint !== null) {
      memories.push({
        cx: diveWaveImprint.x,
        cy: diveWaveImprint.y,
        ringLayoutR: diveWaveImprint.ringLayoutR,
        scale: 1,
      })
    }
    if (underwaterWaveTextRecede !== null) {
      const sc = scaleFromWaitRecede(underwaterWaveTextRecede, clock)
      if (sc > 0) {
        memories.push({
          cx: underwaterWaveTextRecede.cx,
          cy: underwaterWaveTextRecede.cy,
          ringLayoutR: underwaterWaveTextRecede.ringLayoutR,
          scale: sc,
        })
      }
    }
  } else {
    if (surfaceTextImprint !== null) {
      memories.push({
        cx: surfaceTextImprint.cx,
        cy: surfaceTextImprint.cy,
        ringLayoutR: surfaceTextImprint.ringLayoutR,
        scale: 1,
      })
    }
    if (surfaceWaveTextRecede !== null) {
      const { sessionT0: _s, ...recede } = surfaceWaveTextRecede
      const sc = scaleFromWaitRecede(recede, clock)
      if (sc > 0) {
        memories.push({
          cx: recede.cx,
          cy: recede.cy,
          ringLayoutR: recede.ringLayoutR,
          scale: sc,
        })
      }
    }
  }

  return memories.length > 0 ? { memories } : undefined
}

/**
 * Omit the active surface ripple from live bands — its carve-out is tracked in memory so text
 * reaches full apex and recedes smoothly (not tied to ripple list lifetime).
 */
function ripplesForTextLayout(): Ripple[] {
  const surfaceT0 = surfaceTextImprint?.sessionT0 ?? surfaceWaveTextRecede?.sessionT0
  if (surfaceT0 === undefined) return ripples
  return ripples.filter(r => !(r.kind === 'surface' && r.t0 === surfaceT0))
}

addEventListener('click', () => {
  const { cx, cy } = layoutObstacleFromState(jelly)
  const clock = performance.now()
  if (!underwater) {
    pushRipple(ripples, cx, cy, 'dive', MAX_RIPPLES)
    underwater = true
    diveWaveImprint = { x: cx, y: cy, ringLayoutR: [0, 0, 0] }
    underwaterWaveTextRecede = null
  } else {
    pushRipple(ripples, cx, cy, 'surface', MAX_RIPPLES)
    const last = ripples[ripples.length - 1]
    const surfaceT0 = last !== undefined ? last.t0 : clock

    underwater = false
    diveWaveImprint = null
    underwaterWaveTextRecede = null

    surfaceTextImprint = {
      cx,
      cy,
      ringLayoutR: [0, 0, 0],
      sessionT0: surfaceT0,
    }
    surfaceWaveTextRecede = null
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

  underwaterWaveTextRecede = advanceWaitRecedeState(clock, underwaterWaveTextRecede)
  if (surfaceWaveTextRecede !== null) {
    const { sessionT0, ...rest } = surfaceWaveTextRecede
    const next = advanceWaitRecedeState(clock, rest)
    surfaceWaveTextRecede =
      next === null ? null : ({ ...next, sessionT0 } as typeof surfaceWaveTextRecede)
  }

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
