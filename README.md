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
- `js/rendering/`: shared baked-material/HDR pipeline and centralized mobile/desktop presets
- `js/models/customerConfig.js`: backward-compatible customer variant selection
- `js/utils/modelStart.js`: configured starting position/direction, with a legacy automatic fallback
- `lib/`: vendored Three.js runtime files
- `assets/`, `images/`, `models/`: project assets

## Add a new customer / change a walkthrough model

Add or edit an entry in `customers.json` - see `HOSTING_GUIDE.md` for the
full steps, including the link-naming convention and deploy process.

See [RENDERING.md](RENDERING.md) for baked asset metadata, desktop/mobile variants,
local Shareefa validation, quality overrides, and measured results. Existing
customer URLs and models are unchanged. No assets are published by these tools.

Set each model's `startPosition` in `customers.json` to choose its initial
location and direction. Coordinates are metres at **feet height**; `yaw` and
`pitch` are degrees. See the developer starting-position section in
[RENDERING.md](RENDERING.md) for the schema and a console helper that copies the
current walkthrough position. Shareefa's local test is available at
`http://127.0.0.1:5173/shareefa` and uses the reference viewer's living-room start.

Use the home icon below the wall-pass button to return to the model's starting
position and viewing direction. On desktop, press **Home** while exploring, or
press **Esc** to release the cursor and click the icon. On mobile, tap the icon.

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
