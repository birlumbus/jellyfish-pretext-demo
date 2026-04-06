# jellyfish-pretext-demo

Full-page text laid out with [`@chenglou/pretext`](https://github.com/chenglou/pretext) reflows around a circular obstacle that follows a smoothed “jellyfish” cursor. Tendrils are drawn on a top canvas and do not affect layout.

## Develop

```bash
npm install
npm run dev
```

## Build

Default base is `/` (root). For **GitHub Pages** on a project site at `https://<user>.github.io/<repo>/`, build with a matching base path:

```bash
VITE_BASE=/jellyfish-pretext-demo/ npm run build
```

Or:

```bash
npm run build -- --base=/jellyfish-pretext-demo/
```

Upload the `dist/` output or use a GitHub Action that runs `vite build` and publishes `dist/` to Pages.

## Reference

API details: [`chenglou/pretext`](https://github.com/chenglou/pretext) on GitHub; this project uses the npm package only.
