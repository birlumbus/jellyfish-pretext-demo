import { defineConfig } from 'vite'

// For GitHub Pages project sites, set VITE_BASE to your repo name, e.g. VITE_BASE=/jellyfish-pretext-demo/
// npm run build -- --base=/my-repo/ also works.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
})
