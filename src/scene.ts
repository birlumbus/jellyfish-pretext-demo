import { getRippleMaxFootprintRadius } from './ripples.ts'

/** Shared dimensions keep drawing, text carve-outs, and input bounds in sync. */
export function getSceneGeometry(width: number, height: number) {
  const margin = width < 600 ? 24 : 40
  const textWidth = Math.min(700, Math.max(80, width - margin * 2))
  const fontSize = width < 600 ? 19 : 20
  const minimumLineWidth = fontSize * 4.5
  let rippleRadius = Math.min(100, textWidth * 0.24)
  if (width < 600) {
    const availableRadius = Math.max(0, textWidth * 0.5 - minimumLineWidth - 1)
    let low = 0, high = rippleRadius
    // Fit the full water footprint, preserving a readable slot on both sides.
    for (let i = 0; i < 16; i++) {
      const candidate = (low + high) * 0.5
      if (getRippleMaxFootprintRadius(candidate) <= availableRadius) low = candidate
      else high = candidate
    }
    rippleRadius = low
  }
  return {
    width, height,
    textLeft: (width - textWidth) / 2,
    textRight: (width + textWidth) / 2,
    textTop: Math.min(width < 600 ? 24 : 48, height * 0.12),
    bottomMargin: Math.min(40, height * 0.12),
    fontSize, minimumLineWidth,
    lineHeight: width < 600 ? 29 : 32,
    jellyScale: Math.min(1.08, Math.max(0.58, textWidth / 560), height / 300),
    rippleRadius,
  }
}
export type SceneGeometry = ReturnType<typeof getSceneGeometry>
export function clampTarget(x: number, y: number, scene: SceneGeometry) {
  return { x: Math.min(scene.width, Math.max(0, x)), y: Math.min(scene.height, Math.max(0, y)) }
}
