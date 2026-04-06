import './style.css'
import { createJellyfishState, drawJellyfish, stepJellyfish } from './jellyfish'
import {
  BODY_FONT,
  drawLines,
  getPreparedBody,
  layoutLinesForObstacle,
} from './text-layout'

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

  stepJellyfish(jelly, pointerX, pointerY, dt)

  const prepared = getPreparedBody()
  const lines = layoutLinesForObstacle(prepared, width, height, MARGIN, LINE_HEIGHT, jelly)

  text2d.fillStyle = '#0a1628'
  text2d.fillRect(0, 0, width, height)
  drawLines(text2d, lines)

  jelly2d.clearRect(0, 0, width, height)
  drawJellyfish(jelly2d, jelly)

  requestAnimationFrame(frame)
}

void document.fonts.load(BODY_FONT).finally(() => {
  getPreparedBody()
  requestAnimationFrame(t => {
    last = t
    requestAnimationFrame(frame)
  })
})
