# jellyfish-pretext-demo

A sea-glass reading scene: a translucent jellyfish points toward the pointer and eases after it using the original demo's apex attraction and trailing-base spring motion. The bell keeps a fixed shape without a swimming pulse. Softer spring tips and delayed ribbon bends give the fronds water-driven drift and lingering momentum. A compact water crown covers the dive point, droplets fall back into the water, and two tapered wave arcs spread and fade. The disturbed area stays free of text until it closes smoothly. Text layout uses [`@chenglou/pretext`](https://github.com/chenglou/pretext). Three canvases keep the water, jellyfish, and crisp text separate; the splash is painted over the creature and the water light is a static CSS background.

## Interaction

- Move the pointer to swim. On touchscreens, drag to swim and tap to dive.
- Click the scene or use the Dive / Surface button to move below or above the words.
- Tab into the scene, use arrow keys to swim (Shift for larger steps), and Space or Enter to dive.
- The bottom-right interaction hint opens swim/ripple speeds and Still water. Swim speed changes the original following motion and tendril flow. Still water moves immediately, freezes tendril flow, and omits animated ripples; it follows the system reduced-motion preference by default.

The passage is also available to screen readers. Narrow screens scale both the painted creature and its text exclusion geometry; pressure fronts scale to the reading width. The pointer can lead the creature beyond the scene edges. Dive and surface transitions animate depth, scale, and transparency; Still water makes those transitions immediate.

## Develop

```bash
npm install
npm run dev
```

## Verify and build

Use Node 22.18+ for the dependency-free TypeScript geometry tests.

```bash
npm test
npm run build
```

Default base is `/`. For this demo's portfolio route:

```bash
VITE_BASE=/pretext/ npm run build
```

Copy the generated `dist/` into the portfolio's `public/pretext/`. Use source files for edits; those served files are build output.

## Source guide

- `src/scene.ts`: reading bounds, responsive dimensions, and keyboard target limits.
- `src/text-layout.ts`: font preparation, line slots, and text drawing.
- `src/jellyfish.ts`: original spring-following cap/base motion, drifting spring tips and ribbon bends, animated depth, and shared painted/layout outlines.
- `src/ripples.ts`: cached splash crowns and ballistic droplets, compact tapered wave arcs, shared painted/layout bounds, and smooth recession.
- `src/main.ts`: input, dive/surface state, Still water, reduced motion, and rendering.

The original follow regression fixture was recorded from `b305e45:src/jellyfish.ts`. It checks cap and base positions, velocities, and cursor smoothing across a turn, reversal, and rest.
