# Baked rendering and quality presets

This is one viewer using the vendored **Three.js r174**. Navigation, touch input,
collision, ghost mode, customer slugs and Cloudflare root-static hosting remain
in the existing app. Shareefa has a developer-only local registry entry; existing
customer assets are unchanged and no reference GLB is copied into the production
build. The reference package is read-only.

## Configuration

Existing `customers.json` entries work unchanged:

```json
{ "customer-slug": { "name": "Customer", "modelUrl": "EXISTING_ASSET_URL" } }
```

An optional `models` object selects matching variants. These strings are
placeholders: substitute actual uploaded URLs for **that customer's model**.
The mobile/desktop variants must have the same coordinates, scale, and bake.

```json
{
  "customer-slug": {
    "name": "Customer",
    "modelUrl": "EXISTING_FALLBACK_ASSET_URL",
    "rendering": { "profile": "auto" },
    "models": {
      "desktop": "ACTUAL_DESKTOP_ASSET_URL",
      "mobile": "ACTUAL_MOBILE_ASSET_URL"
    }
  }
}
```

Selection order is requested variant, `modelUrl`, desktop variant, mobile
variant. Thus a one-asset customer works in both presets. An HTTP/parse failure
is reported in the existing loading UI; a broken configured URL is not silently
replaced by another model. Variants can alternatively be objects:

```json
{
  "url": "ACTUAL_VARIANT_URL",
  "rendering": { "profile": "shareefa-baked-v1" }
}
```

Variant rendering fields override the customer's rendering fields. Profiles:

- `auto` (default): opt in only when scene extras jointly contain `log12`, a
  positive `lut_exposure`, an `rgb-float16-base64` sky, and a node explicitly
  tagged `vertex_lit: true`. Emissive maps, vertex colours, or filenames alone
  never select this interpretation. Both supplied GLBs meet this signature.
- `shareefa-baked-v1`: explicitly affirm this exporter contract for a known
  asset. Uses `lightmap_encoding`, `lightmap_log_stops`, `lut_exposure` (fallback
  `viewer_exposure`), `sky_equirect`, `vertex_lit`, and `vertex_lit_smooth` extras.
  Optional config `encoding`, `logStops`, `exposure`, `vertexLitNodes` overrides
  metadata when deliberately onboarding an asset without the complete signature.
  No universal exposure is baked into the code. Unsupported/malformed contract
  data is an error, not an uncalibrated fallback. Supported explicit encodings
  are raw `logN` (1–24 stops), raw `linear`, and older Shareefa `sqrt` exports
  containing sRGB(sqrt(E)). Only log12 auto-detects.
- `legacy`: explicitly retain production's previous lighting/fog/material
  behavior. Use for other baked formats unless their contract is implemented.

## Developer-configured starting positions

Set `startPosition` on each entry in `customers.json`. Configured positions bypass
the automatic floor search; they work with every rendering profile and quality
preset. No customer-facing position editor is added.

```json
"startPosition": {
  "x": 43.92,
  "y": 12.5,
  "z": -462.88,
  "yaw": -85,
  "pitch": 0
}
```

`x`, `y`, `z` are world-space metres. **`y` is feet/floor height**, not camera
height; production adds its existing 1.65 m eye height. `yaw` and `pitch` are
degrees and default to zero if omitted. Yaw 0 looks along -Z, -90 along +X;
positive pitch looks up. Pitch must be between -75.6 and 75.6 degrees, matching
the existing controller. Invalid numeric values are rejected with a detailed
developer-console error. Normal floor/wall collision still runs while walking.

The current configuration contains:

| Entry | Feet position (x, y, z) | Yaw | Source |
|---|---|---:|---|
| `demo-sample` | 114.367222, 0.689462, -60.293156 | 0 | Recorded existing default, 2026-11-12 |
| `mansion3` | 1.575476, -0.6, 0.999725 | 90 | Recorded existing default, 2026-11-12 |
| `resort2` | 43.92, 12.5, -462.88 | -85 | Uploaded mobile GLB, verified against the Shareefa mobile reference |
| `shareefa` | 43.92, 12.5, -462.88 | -85 | Reference viewer's resolved living-room bookmark |

Both existing defaults were loaded and recorded before the change, then rounded
to six decimal places. The Shareefa URL's `y=12.16` is a floor-search hint: its
viewer drops onto a surface at y=12.5 (mobile: 12.500149). We store that resolved
feet height, so no initial floor search is needed. The bookmark is beside the
sofa, facing it; walking backward moves into the room. Shareefa retains production's eye height and FOV. Its
entry is `developmentOnly: true`, and its two URLs point to Vite's local read-only
reference routes. Open `http://127.0.0.1:5173/shareefa?quality=desktop` or
`?quality=mobile`. The older `devModel=shareefa` links resolve this same entry.
It is unavailable on production domains; provide real hosted variant URLs and
remove `developmentOnly` when deliberately onboarding a hosted Shareefa model.

`resort2` is the hosted mobile asset supplied on 2026-11-12. Its single `modelUrl`
is used by both presets; the larger desktop GLB remains an internal reference.
Its log12 encoding, calibrated exposure, sky and vertex-light metadata select
the baked renderer automatically. Its metadata, size and R2 ETag match the
supplied mobile reference, so it uses the same verified starting position.

To choose a new starting point, open the customer's local link, walk to a
practical location, face the desired direction, and run this in DevTools:

```js
JSON.stringify(brickratDev.getStartPosition(), null, 2)
```

Paste the returned object into that customer's `startPosition`, save, and reload.
The helper is available only on localhost/127.0.0.1 and returns feet height in
the same schema. The service worker no longer serves a stale cached customer
registry. After upgrading an already open viewer, hard-refresh once if needed.

A variant object can supply its own complete `startPosition`; otherwise it
inherits the customer-level position. Omitted/null positions keep the old
automatic search for backward compatibility. All current records are
explicitly configured, and new models should have a chosen starting point.

Run `node scripts/check-starts.mjs` with Vite running to verify the registry-based
start and floor-safe movement on both supplied Shareefa GLBs. The matching
screenshots/results are saved to `validation/spawn/configured/`.

Validated on 2026-11-12: all 11 focused tests and the production build passed.
Both Shareefa GLBs matched the reference's resolved surface height (12.5 desktop,
12.500149 mobile), loaded without an automatic start scan, and supported forward
and backward movement from the configured bookmark. The built-bundle smoke test
also confirmed that a customer registry start is applied. The two existing model
starts match their recorded defaults within 0.000001 m.

Per-vertex lighting requires tagged node ancestry (or explicit `vertexLitNodes`)
AND COLOR_0 without an emissive map. Untagged vertex colours remain tints.
Multi-material meshes and materials shared between different lighting modes
are isolated. `soft_lm_materials` metadata is retained in the contract; the
optional lightmap-mip cloth correction is disabled, as in v22's default.

## Rendering

`bakedMaterials.js` moves emissive textures to lightmaps with the original UV
channel and transforms. Log codes are sampled with `NoColorSpace`, decoded
after the lightmap fetch, and multiplied by PI. Baked light also feeds indirect
specular; metalness is scaled by 0.3. Vertex-lit primitives receive equivalent
diffuse/specular lighting. Only the desktop preset precomputes v22's weighted
cloth-light smoothing, once during loading.

The baked mode disables scene lights, fog, and opaque sky reflections. Glass
gets a disposable PMREM of the embedded linear half-float sky at 1/exposure.
The background uses the same scale. Materials with `__1s` stay front-sided.
Other contract materials are double-sided. No real-time shadows or room probes.

`BakedRenderer.js` renders linear half-float HDR and then applies the supplied
33³ **Blender AgX Medium High Contrast** LUT at the model's exposure. Bloom and
vignette precede the LUT; optional grain follows it. Three's tone mapping is
disabled. The LUT already produces display sRGB: there is no second output
transform. The LUT is copied verbatim; SHA-256:
`622658f74b1f43eaf51cc642609bb379669028d4f0cdc23c93e2a4004825acbb`.

`bakedShaders.js` checks every patch target occurs exactly once against the
vendored r174 chunks, both before rendering and on actual compilation. Program
cache keys include the encoding and cloth mode. Shader compilation/link errors
fail the load visibly and log details to the developer console. Upgrading Three
requires rerunning these checks and visual comparisons.

HDR availability and framebuffer completeness are checked. Desktop sample counts
intersect the supported RGBA16F and r174 DEPTH_COMPONENT24 counts; an incomplete
MSAA target is retried with zero samples. Devices unable to render half-float HDR
show a rendering-unavailable message rather than silently clipping to 8-bit.
Resize follows production's visualViewport/orientation flow and resizes HDR and
bloom buffers. Materials, cloned lightmaps/geometries, sky/PMREM, LUT, bloom,
render targets, decoders, and loaded assets are disposed on errors or page exit.
Back/forward-cached pages retain their resources for resume.

## Quality settings

Tune `js/rendering/quality.js`; controls are selected independently.

| Setting | Mobile | Desktop |
|---|---:|---:|
| Pixel ratio cap | 1.25 | 2 |
| HDR samples | 0 | up to 4, subject to support |
| Texture anisotropy cap | 1 | 16, subject to support |
| Cloth correction | off | on, strength 0.5, lift cap 2 |
| Bloom | off | 0.05, threshold 2, six levels |
| Vignette | off | 0.10 |
| Grain | off | off (optional central setting) |
| Reflection probes | off | off |

Both presets use identical decoding, exposure, basic specular, sky/glass and
Blender colour transforms. Coarse pointers, a screen with a short side <=768 px,
or reported device memory <=4 GB default to mobile. Otherwise desktop is used.
Selection is stable through orientation changes. On loopback hosts only,
`?quality=mobile` or `?quality=desktop` overrides quality without changing input
controls. There is no customer-facing technical settings UI.

## Local integration and reproducible checks

```powershell
npm test
npm run build
node node_modules/vite/bin/vite.js --host 127.0.0.1
```

Open:

- `http://127.0.0.1:5173/local-validation?devModel=shareefa&quality=desktop`
- `http://127.0.0.1:5173/local-validation?devModel=shareefa&quality=mobile`

`devVariant=desktop|mobile` fixes the asset independently of the preset, and
`devProfile=legacy` selects the previous lights/fog/material rendering path for
same-asset comparisons. These overrides are loopback-only and do not modify the
customer asset URLs. The shortcuts use the `shareefa` registry entry for variants
and starting position. Vite's exact read-only allowlist serves the two sibling package GLBs;
it does not expose arbitrary files or exist in production hosting. If the
package is absent the local reference request returns 404.

With Vite running and Chrome installed (or `CHROME_PATH` configured):

```powershell
node scripts/capture-rendering.mjs mobile desktop
node scripts/capture-rendering.mjs mobile mobile
node scripts/capture-rendering.mjs mobile desktop legacy
node scripts/capture-rendering.mjs desktop desktop
node scripts/check-viewer.mjs desktop
node scripts/check-viewer.mjs mobile
node scripts/check-render-errors.mjs
python scripts/compare-captures.py
```

The comparison script needs Pillow and NumPy. To verify the built bundle, run
`node node_modules/vite/bin/vite.js preview --host 127.0.0.1` in another terminal,
then `node scripts/check-build.mjs`. It supplies the local mobile GLB through a
tab-only intercepted test registry; it never edits `customers.json`.

Captures, camera coordinates, timings and browser errors go into ignored
`validation/`. Run desktop quality first for each model: subsequent preset and
legacy runs reuse its exact camera coordinates. Captures reproduce the
reference viewer's floor-drop camera placement, 1.6 m capture eye height and
70° FOV; the customer navigation remains at production's 1.65 m and 88° FOV.
Frame benchmarks use three runs of 30 back-to-back frames after warmup, with a
synchronous 1-pixel GPU read after each frame. This measures render submission
and completion overhead, excluding navigation/loading; it is not rAF FPS or a
GPU-timer-query measurement. No second maintained viewer was introduced.

`npm run build` also copies the current customer registry, decoder files,
manifest and icons into dist so preview has the stable runtime URLs. Root-static
Cloudflare config is unchanged. The service-worker shell cache is versioned to
v5; same-origin files check the network before falling back to the shell cache,
and `/customers.json` is never cached. A replacement worker reloads an already
controlled page once; a first installation does not reload. Browsers still running
an older cached HTML page may need one hard refresh when migrating to this version.
Network failures without a usable cache return HTTP 503 instead of rejecting the
service worker's fetch promise. Nothing is deployed or uploaded by these commands.

## Observed validation (2026-11-11)

Windows Chrome, Intel Iris Xe via ANGLE/D3D11, 960×600 drawing buffer, DPR 1.
The same mobile GLB and `int_living_n` camera were used for the first three rows:

| Rendering path / asset | Mean frame time, three runs | Material + HDR setup | Local time to ready |
|---|---|---:|---:|
| Previous renderer / mobile GLB | 43.01, 43.70, 43.33 ms | <1 ms | 3.20 s |
| Mobile preset / mobile GLB | 33.82, 35.00, 35.53 ms | 206 ms | 3.45 s |
| Desktop preset / mobile GLB | 38.94, 38.64, 38.17 ms | 781 ms | 4.56 s |
| Desktop preset / desktop GLB | 48.16, 49.26, 49.51 ms | 1,980 ms | 13.52 s |

Load values are single local runs, not download benchmarks. Cache state, file
size and disk/network warmup differ; compare continuous frame costs separately.
Desktop cloth/material adaptation alone was 588 ms on the mobile GLB and
1,800 ms on the full GLB; mobile material adaptation was 30 ms. No geometry or
texture optimization runs during loading. Full-model timings are a different
asset and must not be interpreted as a preset-only comparison.

At matched desktop v22 effect settings (bloom .05, vignette .10, grain/probes 0,
cloth on), 4 HDR samples, 960×600, and supplied fixed cameras:

| Model vs its supplied v22 capture set | Median RGB MAE (0–1) | Median mean-RGB brightness ratio | Worst view MAE |
|---|---:|---:|---:|
| Desktop GLB | 0.00243 | 1.00117 | 0.00830, int_living_view |
| Mobile GLB with desktop preset | 0.00233 | 1.00076 | 0.00819, int_living_view |

The largest localized discrepancy is the glass/slatted-window area in
`int_living_view`; it is visibly brighter than the supplied capture. The exact
cause has not been isolated (different Three versions and GPU/browser stacks).
Do not describe this as pixel-identical. Furniture, walls, thin surfaces and sky
were inspected in the saved comparison sheets. Mobile uses no HDR MSAA and has
more visible stair-stepping on high-contrast thin edges at DPR 1; keep the zero
sample default until phone testing supports paying for AA. Mobile's disabled
effects and lower filtering are intentional differences, so comparisons against
v22's default captures are not port-parity measurements.

Both GLBs compiled/loaded with 1,001 raw lightmaps on UV channel 1, 241 vertex-lit
primitives, 30 sky-lit glass primitives, and 282 correctly single-sided
primitives. Desktop smoothed 70 cloth primitives; mobile smoothed none. No
active scene lights/fog remained. Eight focused tests cover existing registry
records/fallbacks, profile isolation, shader target failures, UV preservation,
shared-material isolation, glass, cloth, sample support and GLB metadata.

Browser checks passed loading-to-ready, unknown/missing links, failed model
loading, desktop keyboard/mouse-look events, floor/wall collision, 3 s ghost
mode (including Space), touch joystick/look/release, and portrait/landscape plus
desktop resize. Collision assertions use a deterministic floor/wall fixture
after the supplied GLB loads. Actual native pointer lock could not be verified:
headless Chrome returns WrongDocumentError; visible-browser computer-use app
access timed out. Its existing handlers and navigation source are unchanged.
The only incidental capture network error was the existing missing favicon.

Three injected browser failures also passed: missing WebGL 2, missing HDR
half-float support, and a changed shader patch target all show the appropriate
error screen. The production bundle smoke test loaded the mobile GLB through
a customer slug and verified registry, manifest/icons, service worker, Draco
and KTX2 support files byte-for-byte against their source paths.

## Remaining release checks

- Configure real per-customer variant URLs after those assets exist. None were
  invented, uploaded, or changed here. Existing customer model URLs remain unchanged.
- Test a visible desktop browser's native click-to-lock/Escape flow.
- Test physical Android and iOS devices for sustained frame times, thermal
  behavior, memory pressure, touch/fullscreen, glass/transmission and edge
  quality. Browser emulation is not a real-phone benchmark.
- Draco and WebP decoding were exercised by both supplied GLBs. KTX2 loader and
  self-hosted transcoder support remain wired; no actual customer KTX2 asset was
  supplied for an end-to-end Basis texture check.
- Optimize geometry/textures offline only. Never process log lightmaps with
  ordinary sRGB resizing, chroma-subsampled colour compression or KTX2/Basis.
  Retain the encoder's deliberate raw-code JPEG 4:4:4 treatment. Normal colour
  textures may use the existing offline KTX2 path for other compatible assets.
