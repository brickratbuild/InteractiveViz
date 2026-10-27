# Brickrat Main Example

Static Three.js walkthrough app for exploring a hosted GLB model in the
browser. Each customer gets their own link, `https://view.brickrat.com/<slug>`,
which loads that customer's model from Cloudflare R2.

## Restore local setup

```bash
git clone https://github.com/minhajfalaki/Brickrat_main_example.git
cd Brickrat_main_example
npm install
npm run dev
```

Open `http://localhost:5173/<slug>`, e.g. `http://localhost:5173/demo-sample`.

## Project structure

- `index.html`: app shell, overlays, and PWA hooks
- `main.js`: scene setup, slug -> model resolution, and runtime flow
- `customers.json`: maps each customer's link slug to their model URL
- `js/controls/`: first-person desktop and mobile controls
- `lib/`: vendored Three.js runtime files
- `assets/`, `images/`, `models/`: project assets

## Add a new customer / change a walkthrough model

Add or edit an entry in `customers.json` - see `HOSTING_GUIDE.md` for the
full steps, including the link-naming convention and deploy process.

## Push changes

```bash
git add .
git commit -m "Describe the change"
git push origin main
```

If Git reports "dubious ownership" on this machine, run:

```bash
git config --global --add safe.directory E:/BrickRat/Brickrat_App/Brickrat_main_example
```
