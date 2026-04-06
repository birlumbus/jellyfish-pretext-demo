export type Interval = {
  left: number
  right: number
}

/** Horizontal x-interval where a circle intersects a horizontal band [bandTop, bandBottom]. */
export function circleBlockedIntervalForBand(
  cx: number,
  cy: number,
  radius: number,
  bandTop: number,
  bandBottom: number,
): Interval | null {
  const yMin = Math.max(bandTop, cy - radius)
  const yMax = Math.min(bandBottom, cy + radius)
  if (yMin > yMax) return null

  const yPick = Math.min(Math.max(cy, yMin), yMax)
  const dy = yPick - cy
  const w2 = radius * radius - dy * dy
  if (w2 <= 0) return null
  const halfW = Math.sqrt(w2)
  return { left: cx - halfW, right: cx + halfW }
}

/** Subtract blocked intervals from a full-width band; drop slivers narrower than the minimum line width. */
export function carveTextLineSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots: Interval[] = [base]

  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]!
    const next: Interval[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }

  return slots.filter(slot => slot.right - slot.left >= 24)
}

/** Merge overlapping / touching intervals (for multiple obstacles per band). */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.left - b.left)
  const out: Interval[] = []
  let cur = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    if (n.left <= cur.right) {
      cur = { left: cur.left, right: Math.max(cur.right, n.right) }
    } else {
      out.push(cur)
      cur = n
    }
  }
  out.push(cur)
  return out
}
