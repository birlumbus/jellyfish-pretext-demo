import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext'
import { BODY_COPY } from './copy'
import { blockedIntervalsForLayout, type JellyfishState } from './jellyfish'
import {
  blockedIntervalsForRippleBands,
  blockedIntervalsForWaveMemory,
  type Ripple,
} from './ripples'
import { carveTextLineSlots, mergeIntervals, type Interval } from './intervals'

export const BODY_FONT =
  '400 19px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif'

/** Page background (must match CSS `body` / stage fill). Used to turn glyph rgba into a solid color when text is composited above the jelly layer. */
const PAGE_BG = { r: 0x0a, g: 0x16, b: 0x28 }
/** Glyphs were `rgba(232, 224, 208, 0.92)` on the page background; solid equivalent so text does not pick up the jelly underneath. */
const TEXT_FILL_SOLID = (() => {
  const tr = 232
  const tg = 224
  const tb = 208
  const a = 0.92
  const r = Math.round(tr * a + PAGE_BG.r * (1 - a))
  const g = Math.round(tg * a + PAGE_BG.g * (1 - a))
  const b = Math.round(tb * a + PAGE_BG.b * (1 - a))
  return `rgb(${r} ${g} ${b})`
})()

export type LaidOutLine = {
  x: number
  y: number
  text: string
}

let preparedCache: PreparedTextWithSegments | null = null

export function getPreparedBody(): PreparedTextWithSegments {
  if (preparedCache === null) {
    preparedCache = prepareWithSegments(BODY_COPY, BODY_FONT)
  }
  return preparedCache
}

export function layoutLinesForObstacle(
  prepared: PreparedTextWithSegments,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  lineHeight: number,
  jelly: JellyfishState,
  rippleLayout?: {
    ripples: readonly Ripple[]
    nowMs: number
    /** Ripple animation speed (1 = default). Passed to ripple layout. */
    rippleSpeed?: number
    /** When true (underwater), text ignores the jellyfish; only waves affect layout. */
    omitJellyObstacle?: boolean
    /** Each memory has its own scale (1 = full carve-out, → 0 while receding). */
    waveMemory?: {
      memories: {
        cx: number
        cy: number
        ringLayoutR: readonly [number, number, number]
        scale: number
      }[]
    }
  },
): LaidOutLine[] {
  const lines: LaidOutLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const baseLeft = margin
  const baseRight = pageWidth - margin
  let lineTop = margin

  while (lineTop + lineHeight <= pageHeight - margin) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight

    let blocked: Interval[] = rippleLayout?.omitJellyObstacle
      ? []
      : blockedIntervalsForLayout(jelly, bandTop, bandBottom)
    if (rippleLayout !== undefined) {
      const { ripples, nowMs, waveMemory, rippleSpeed = 1 } = rippleLayout
      if (waveMemory !== undefined && waveMemory.memories.length > 0) {
        for (const m of waveMemory.memories) {
          if (m.scale <= 0) continue
          const memoryBlocked = blockedIntervalsForWaveMemory(
            m.cx,
            m.cy,
            m.ringLayoutR,
            m.scale,
            bandTop,
            bandBottom,
          )
          blocked = mergeIntervals([...blocked, ...memoryBlocked])
        }
      }
      const rippleBlocked = blockedIntervalsForRippleBands(ripples, nowMs, bandTop, bandBottom, rippleSpeed)
      blocked = mergeIntervals([...blocked, ...rippleBlocked])
    }
    const slots = carveTextLineSlots({ left: baseLeft, right: baseRight }, blocked)
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    slots.sort((a, b) => a.left - b.left)

    if (slots.length === 1) {
      const slot = slots[0]!
      const maxWidth = slot.right - slot.left
      const line = layoutNextLine(prepared, cursor, maxWidth)
      if (line === null) break
      lines.push({ x: slot.left, y: lineTop, text: line.text })
      cursor = line.end
    } else {
      let lineCursor = cursor
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s]!
        const maxWidth = slot.right - slot.left
        const line = layoutNextLine(prepared, lineCursor, maxWidth)
        if (line === null) break
        lines.push({ x: slot.left, y: lineTop, text: line.text })
        lineCursor = line.end
      }
      cursor = lineCursor
    }

    lineTop += lineHeight
  }

  return lines
}

export function drawLines(ctx: CanvasRenderingContext2D, lines: LaidOutLine[]): void {
  ctx.font = BODY_FONT
  ctx.fillStyle = TEXT_FILL_SOLID
  ctx.textBaseline = 'top'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    ctx.fillText(line.text, line.x, line.y)
  }
}
