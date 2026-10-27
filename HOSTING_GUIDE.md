# Hosting Guide - Building Walkthrough

## Overview

| What | Where |
|------|-------|
| Code (HTML, JS, lib, styles) | GitHub repo (`brickratbuild/InteractiveViz`) + Cloudflare Pages |
| GLB models (large files) | Cloudflare R2, one object per customer |
| Customer -> model mapping | `customers.json` at the repo root |

Every customer gets their own link: `https://brickrat.com/<customer-slug>`.
Anyone who has that link can open that customer's model - there is no
login yet (see "Future: access control" below). Because of that, use a
random, non-guessable slug (e.g. `a8f3k2`), not the customer's real name
or company, so other customers' links can't be easily guessed.

---

## Adding a new customer (the only recurring task)

1. Upload the customer's `.glb` to Cloudflare R2 and copy its public URL
   (same as today - `pub-....r2.dev/...` or a custom R2 domain).
2. Open `customers.json` at the repo root and add an entry:

   ```json
   {
     "existing-slug": { "...": "..." },
     "a8f3k2": {
       "name": "Jane's Residence",
       "modelUrl": "https://pub-xxxxxxxx.r2.dev/jane-residence.glb"
     }
   }
   ```

3. Commit and push to `main` (see "Deploying" below). Cloudflare Pages
   rebuilds and deploys automatically, usually within a minute.
4. Send the customer `https://brickrat.com/a8f3k2`.

No other code change is needed - `main.js` reads the first path segment
of the URL as the slug, looks it up in `customers.json`, and loads that
customer's model. An unknown or missing slug shows an in-app "Link not
found" message instead of crashing.

---

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173/<slug>`, e.g. `http://localhost:5173/demo-sample`.
The bare root URL (`/`) has no slug, so it intentionally shows "Link not found".

---

## Deploying code (Cloudflare Workers - static assets)

Cloudflare's current dashboard sets this up as a **Worker with static
assets** (its onboarding flow has absorbed what used to be the separate
"Pages" product). It deploys the raw repo files directly - there is no
build step, exactly like the current GitHub Pages setup. `main.js` is
loaded by the browser as a native ES module straight from the repo.

Two config files make this work and must be pushed before the first deploy:

- `wrangler.jsonc` - tells Cloudflare to serve the repo root as static
  assets, and to fall back to `index.html` for any unmatched path (so
  `/<slug>` resolves client-side instead of 404ing).
- `.assetsignore` - excludes `node_modules/`, `dist/`, `scripts/`,
  `assets2/` (unused leftover textures), docs, and config files from
  being uploaded as public assets. Without this, the deploy would try to
  publish `node_modules` (1000+ files) to the public site.

```bash
git add index.html main.js customers.json wrangler.jsonc .assetsignore js/ lib/ images/ styles/ assets/icons/ assets/thumbnails/ .nojekyll manifest.json sw.js README.md HOSTING_GUIDE.md
git commit -m "Update walkthrough"
git push origin main
git push interactiveviz main
```

### One-time Cloudflare setup

1. Cloudflare dashboard -> **Workers & Pages** -> **Create application** -> **Connect to Git** (or **Import a repository**).
2. Pick the `brickratbuild/InteractiveViz` repo, branch `main`.
3. Project name: `interactiveviz` (matches `wrangler.jsonc`'s `"name"`).
4. Build command: leave empty (no build step).
5. Deploy command: leave the default `npx wrangler deploy` - it reads
   `wrangler.jsonc` to know what to publish.
6. Deploy. Cloudflare gives you a `*.workers.dev` URL immediately - test
   a customer link there first (`https://interactiveviz.<subdomain>.workers.dev/demo-sample`).
7. Add your domain: the project's **Settings** -> **Domains & Routes** ->
   **Add** -> **Custom domain** -> enter `brickrat.com` (and/or
   `www.brickrat.com`). If `brickrat.com`'s DNS already lives in the same
   Cloudflare account - likely, since the R2 bucket is already there -
   Cloudflare adds the needed DNS record and issues SSL automatically
   within a few minutes. If `brickrat.com` is registered but its
   nameservers point elsewhere, Cloudflare shows you the record to add
   at your registrar instead.
8. From then on, every push to `main` auto-deploys. Customer links become
   `https://brickrat.com/<slug>`.

---

## Future: access control

Right now any link opens its model to anyone who has it - fine for
"one unguessable link per customer," not fine once a customer's privacy
matters more than that. When that's needed, the plan is a Cloudflare
Worker in front of Pages/R2 that checks a username+password (or session
cookie) before returning the model URL or redirecting to a signed,
short-lived R2 URL - see `R2_Download_Agent_Notes.md` for the relevant
Worker-streaming and signed-URL patterns. That is not implemented yet.
