/**
 * Original spring-following bell, flowing tendrils, animated depth, and splash-to-wave transitions.
 * Water is a static CSS backdrop; separate canvases keep the creature beneath crisp text.
 */
import './style.css'
import { BODY_COPY } from './copy'
import { clampTarget, getSceneGeometry } from './scene'
import { createJellyfishState, drawJellyfish, layoutObstacleFromState, setJellyfishDepth, stepJellyfish } from './jellyfish'
import { drawRipples, drawSplash, pushRipple, stepRipples, type Ripple } from './ripples'
import { getBodyFont, drawLines, getPreparedBody, layoutLinesForObstacle } from './text-layout'

const stageRoot = document.getElementById('stage')
if (stageRoot === null) throw new Error('#stage missing')
const stageEl: HTMLElement = stageRoot
const bgCanvasEl = document.getElementById('bg-canvas')
const textCanvasEl = document.getElementById('text-canvas')
const jellyCanvasEl = document.getElementById('jelly-canvas')
if (!(bgCanvasEl instanceof HTMLCanvasElement)) throw new Error('#bg-canvas missing')
if (!(textCanvasEl instanceof HTMLCanvasElement)) throw new Error('#text-canvas missing')
if (!(jellyCanvasEl instanceof HTMLCanvasElement)) throw new Error('#jelly-canvas missing')
const bgCanvas = bgCanvasEl
const textCanvas = textCanvasEl
const jellyCanvas = jellyCanvasEl

const bgCtxRaw = bgCanvas.getContext('2d')
const textCtxRaw = textCanvas.getContext('2d')
const jellyCtxRaw = jellyCanvas.getContext('2d')
if (bgCtxRaw === null || textCtxRaw === null || jellyCtxRaw === null) throw new Error('2d context unavailable')
const bgCtx: CanvasRenderingContext2D = bgCtxRaw
const textCtx: CanvasRenderingContext2D = textCtxRaw
const jellyCtx: CanvasRenderingContext2D = jellyCtxRaw

let dpr = window.devicePixelRatio || 1
let width = 0, height = 0
let pointerX = 0, pointerY = 0
let scene = getSceneGeometry(0, 0)
let jelly = createJellyfishState(0, 0)
let underwater = false
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let stillWater = reducedMotion.matches
let jellySpeedScale = 1, rippleSpeedScale = 1
let requestedFrame = 0
let fontsReady = false
const ripples: Ripple[] = []

function requestRender(): void {
  if (fontsReady && requestedFrame === 0) requestedFrame = requestAnimationFrame(frame)
}
function clearWaves(): void { ripples.length = 0 }

function resize(): void {
  const oldWidth = width
  const oldHeight = height
  dpr = window.devicePixelRatio || 1
  const rect = stageEl.getBoundingClientRect()
  width = rect.width
  height = rect.height
  scene = getSceneGeometry(width, height)
  const target = clampTarget(
    oldWidth > 0 ? pointerX / oldWidth * width : width * 0.52,
    oldHeight > 0 ? pointerY / oldHeight * height : height * 0.40,
    scene,
  )
  pointerX = target.x
  pointerY = target.y
  jelly = createJellyfishState(pointerX, pointerY)
  setJellyfishDepth(jelly, underwater, true)
  clearWaves()
  for (const c of [bgCanvas, jellyCanvas, textCanvas]) {
    c.width = Math.floor(width * dpr)
    c.height = Math.floor(height * dpr)
    c.style.width = `${width}px`
    c.style.height = `${height}px`
  }
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  textCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  jellyCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  requestRender()
}

function setTarget(x: number, y: number): void {
  pointerX = x
  pointerY = y
  if (stillWater) {
    jelly = createJellyfishState(pointerX, pointerY)
    setJellyfishDepth(jelly, underwater, true)
  }
  requestRender()
}

function setTargetFromPointer(e: PointerEvent): void {
  const rect = stageEl.getBoundingClientRect()
  setTarget(e.clientX - rect.left, e.clientY - rect.top)
}

const hint = document.getElementById('interaction-hint')!
const touchPointer = matchMedia('(pointer: coarse)')
function updateHint(keyboard = false): void {
  hint.textContent = keyboard ? 'Arrow keys to swim. Space to dive.'
    : touchPointer.matches ? 'Drag to swim. Tap to dive.' : 'Move to swim. Click to dive.'
}
updateHint()
touchPointer.addEventListener('change', () => updateHint())

let dragStart: { x: number; y: number; id: number } | null = null
let dragged = false
stageEl.addEventListener('pointerdown', e => {
  if (dragStart !== null && dragStart.id !== e.pointerId) return
  dragged = false
  dragStart = { x: e.clientX, y: e.clientY, id: e.pointerId }
  if (e.pointerType === 'touch') stageEl.setPointerCapture(e.pointerId)
  setTargetFromPointer(e)
})
window.addEventListener('pointermove', e => {
  if (dragStart !== null && dragStart.id !== e.pointerId) return
  if (e.pointerType === 'touch' && dragStart === null) return
  if (dragStart !== null && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 8) dragged = true
  updateHint()
  setTargetFromPointer(e)
})
window.addEventListener('pointerup', e => { if (dragStart?.id === e.pointerId) dragStart = null })
window.addEventListener('pointercancel', e => { if (dragStart?.id === e.pointerId) { dragStart = null; dragged = true } })
stageEl.addEventListener('click', () => {
  if (!dragged) toggleDepth()
  dragged = false
})
stageEl.addEventListener('keydown', e => {
  const step = e.shiftKey ? 56 : 28
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  }
  const move = moves[e.key]
  if (move !== undefined) {
    e.preventDefault()
    updateHint(true)
    const target = clampTarget(pointerX + move[0], pointerY + move[1], scene)
    setTarget(target.x, target.y)
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    updateHint(true)
    toggleDepth()
  }
})
stageEl.addEventListener('blur', () => updateHint())
new ResizeObserver(resize).observe(stageEl)
resize()

const diveButton = document.getElementById('dive')!
const depthLabel = document.getElementById('depth-label')!
const depthStatus = document.getElementById('depth-status')!
function updateDepth(): void {
  depthLabel.textContent = underwater ? 'Surface' : 'Dive'
  diveButton.setAttribute('aria-label', underwater ? 'Return to the surface' : 'Dive below the words')
  depthStatus.textContent = underwater ? 'Below the words.' : 'At the surface.'
}
diveButton.addEventListener('click', toggleDepth)

function toggleDepth(): void {
  underwater = !underwater
  setJellyfishDepth(jelly, underwater, stillWater)
  if (!stillWater) {
    const { cx, cy, r } = layoutObstacleFromState(jelly, scene.jellyScale)
    const above = layoutObstacleFromState({ ...jelly, depth: 0 }, scene.jellyScale)
    const below = layoutObstacleFromState({ ...jelly, depth: 1 }, scene.jellyScale)
    const ripple = pushRipple(ripples, cx, cy, underwater ? 'dive' : 'surface', 3, scene.rippleRadius, r * 1.12)
    ripple.depthAtImpact = jelly.depth
    ripple.depth = jelly.depth
    ripple.depthShift = { x: below.cx - above.cx, y: below.cy - above.cy }
  } else {
    clearWaves()
  }
  updateDepth()
  requestRender()
}

function bindSpeedSliders(): void {
  const jellyEl = document.getElementById('jelly-speed')
  const jellyLabel = document.getElementById('jelly-speed-val')
  const rippleEl = document.getElementById('ripple-speed')
  const rippleLabel = document.getElementById('ripple-speed-val')
  if (!(jellyEl instanceof HTMLInputElement) || !(jellyLabel instanceof HTMLElement)) return
  if (!(rippleEl instanceof HTMLInputElement) || !(rippleLabel instanceof HTMLElement)) return

  const apply = (): void => {
    jellySpeedScale = Number(jellyEl.value) / 100
    rippleSpeedScale = Number(rippleEl.value) / 100
    jellyLabel.textContent = `${jellySpeedScale.toFixed(2)}×`
    rippleLabel.textContent = `${rippleSpeedScale.toFixed(2)}×`
    jellyEl.setAttribute('aria-valuenow', jellyEl.value)
    rippleEl.setAttribute('aria-valuenow', rippleEl.value)
    jellyEl.setAttribute('aria-valuetext', `${jellySpeedScale.toFixed(2)} times normal speed`)
    rippleEl.setAttribute('aria-valuetext', `${rippleSpeedScale.toFixed(2)} times normal speed`)
    requestRender()
  }
  jellyEl.addEventListener('input', apply)
  rippleEl.addEventListener('input', apply)
  apply()
}
bindSpeedSliders()

const passage = document.getElementById('accessible-passage')!
passage.textContent = BODY_COPY
const stillInput = document.getElementById('still-water') as HTMLInputElement
let userChoseMotion = false
function syncSpeedControls(): void {
  for (const id of ['jelly-speed', 'ripple-speed']) {
    const slider = document.getElementById(id) as HTMLInputElement
    slider.disabled = stillWater
  }
}
function applyStillWater(): void {
  stillWater = stillInput.checked
  if (stillWater) {
    clearWaves()
    jelly = createJellyfishState(pointerX, pointerY)
    setJellyfishDepth(jelly, underwater, true)
  }
  syncSpeedControls()
  last = performance.now()
  requestRender()
}
stillInput.checked = stillWater
stillInput.addEventListener('change', () => { userChoseMotion = true; applyStillWater() })
reducedMotion.addEventListener('change', () => {
  if (!userChoseMotion) {
    stillInput.checked = reducedMotion.matches
    applyStillWater()
  }
})
const settings = document.getElementById('motion-settings') as HTMLDetailsElement
settings.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    settings.open = false
    settings.querySelector('summary')?.focus()
  }
})
document.addEventListener('pointerdown', e => {
  if (e.target instanceof Node && !settings.contains(e.target)) settings.open = false
})

let last = performance.now()
applyStillWater()
function frame(now: number): void {
  requestedFrame = 0
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (!stillWater) {
    stepJellyfish(jelly, pointerX, pointerY, dt, jellySpeedScale)
    stepRipples(ripples, dt, rippleSpeedScale)
    for (const ripple of ripples) ripple.depth = jelly.depth
  }
  const lines = layoutLinesForObstacle(getPreparedBody(scene.fontSize), scene, jelly, { ripples })
  bgCtx.clearRect(0, 0, width, height)
  drawRipples(bgCtx, ripples)
  jellyCtx.clearRect(0, 0, width, height)
  drawJellyfish(jellyCtx, jelly, { scale: scene.jellyScale })
  drawSplash(jellyCtx, ripples)
  textCtx.clearRect(0, 0, width, height)
  drawLines(textCtx, lines, scene.fontSize)
  if (!stillWater) requestRender()
}
void document.fonts.load(getBodyFont(scene.fontSize)).finally(() => {
  getPreparedBody(scene.fontSize)
  fontsReady = true
  last = performance.now()
  requestRender()
})
