import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '@chenglou/pretext'
import type { SceneGeometry } from './scene'
import { BODY_COPY } from './copy'
import { blockedIntervalsForLayout, type JellyfishState } from './jellyfish'
import {
  blockedIntervalsForRippleBands,
  type Ripple,
} from './ripples'
import { carveTextLineSlots, mergeIntervals, type Interval } from './intervals'

export function getBodyFont(size = 20): string {
  return `400 ${size}px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`
}
const TEXT_FILL = '#ddede7'

export type LaidOutLine = {
  x: number
  y: number
  text: string
}

const preparedCache = new Map<string, PreparedTextWithSegments>()
export function getPreparedBody(size = 20): PreparedTextWithSegments {
  const font = getBodyFont(size)
  let prepared = preparedCache.get(font)
  if (prepared === undefined) {
    prepared = prepareWithSegments(BODY_COPY, font)
    preparedCache.set(font, prepared)
  }
  return prepared
}

export function layoutLinesForObstacle(
  prepared: PreparedTextWithSegments,
  scene: SceneGeometry,
  jelly: JellyfishState,
  rippleLayout?: { ripples: readonly Ripple[] },
): LaidOutLine[] {
  const lines: LaidOutLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  const { lineHeight, height: pageHeight } = scene
  const baseLeft = scene.textLeft
  const baseRight = scene.textRight
  let lineTop = scene.textTop

  while (lineTop + lineHeight <= pageHeight - scene.bottomMargin) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight

    let blocked: Interval[] = blockedIntervalsForLayout(jelly, bandTop, bandBottom, scene.jellyScale)
    if (rippleLayout !== undefined) {
      const pressure = blockedIntervalsForRippleBands(rippleLayout.ripples, bandTop, bandBottom)
      blocked = mergeIntervals([...blocked, ...pressure])
    }
    const slots = carveTextLineSlots({ left: baseLeft, right: baseRight }, blocked, scene.minimumLineWidth)
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

export function drawLines(ctx: CanvasRenderingContext2D, lines: LaidOutLine[], fontSize = 20): void {
  ctx.font = getBodyFont(fontSize)
  ctx.fillStyle = TEXT_FILL
  ctx.textBaseline = 'top'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    ctx.fillText(line.text, line.x, line.y)
  }
}
