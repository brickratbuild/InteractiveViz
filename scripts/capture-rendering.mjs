// Local integration: node scripts/capture-rendering.mjs desktop desktop [legacy]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSession, sleep } from './browser-session.mjs';

const [variant = 'mobile', quality = 'mobile', profile = 'auto'] = process.argv.slice(2);
if (![variant, quality].every(v => ['mobile', 'desktop'].includes(v))) throw new Error('Expected mobile/desktop variant and preset');
if (!['auto', 'legacy'].includes(profile)) throw new Error('Expected auto/legacy profile');
const output = path.resolve(`validation/${variant}-${quality}-${profile}`);
const browser = await browserSession(output);
const { call, evaluate, events } = browser;
const summary = { variant, quality, profile, viewport: [960, 600], deviceScaleFactor: 1, errors: [] };
try {
  await call('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:5173/local-validation?devModel=shareefa&quality=${quality}&devVariant=${variant}&devProfile=${profile}` });
  let status;
  for (let i = 0; i < 600; i++) {
    await sleep(250);
    status = await evaluate('window.brickratDev?.status()');
    if (status?.failed) throw new Error('Model failed: ' + JSON.stringify(events.filter(e => e.method === 'Runtime.consoleAPICalled')));
    if (status?.ready) break;
  }
  if (!status?.ready) throw new Error('Model did not become ready');
  summary.status = status;
  console.log('READY', JSON.stringify(status));
  await sleep(500);
  await evaluate("document.querySelectorAll('.overlay, #fpsCounter, #btnGhost, #crosshair, #escHint, #btnFullscreen, #rotatePrompt').forEach(e => e.style.display = 'none')");
  const views = JSON.parse(await readFile(new URL('../../shareefa_walkthrough_2026-11-11/v13/reference/views/views.json', import.meta.url)));
  summary.cameras = {};
  let fixedCameras;
  if (quality !== 'desktop' || profile !== 'auto') {
    try { fixedCameras = JSON.parse(await readFile(`validation/${variant}-desktop-auto/summary.json`)).cameras; } catch { /* first run */ }
  }
  for (const view of views) {
    // Reference placeAt snaps to floor + 1.6 m. Reproduce its raycast here,
    // then set the production camera explicitly (production walking height is 1.65 m).
    const camera = fixedCameras?.[view.name] || await evaluate(`(async () => {
      const THREE = await import('/lib/three/three.module.js'); const d = brickratDev;
      const ray = new THREE.Raycaster(new THREE.Vector3(${view.x}, ${view.y} + 1, ${view.z}), new THREE.Vector3(0,-1,0), 0, 1000);
      ray.firstHitOnly = true;
      const hits = ray.intersectObjects(d.controller._meshes, false);
      const y = hits.length ? hits[0].point.y + 1.6 : ${view.y} + 1.6;
      const camera = ${JSON.stringify(view)}; camera.y = y; d.placeCamera(camera);
      return { ...camera, fov: d.camera.fov, aspect: d.camera.aspect };
    })()`);
    if (fixedCameras?.[view.name]) await evaluate(`brickratDev.placeCamera(${JSON.stringify(camera)})`);
    summary.cameras[view.name] = camera;
    await sleep(120);
    const capture = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, `${view.name}.png`), Buffer.from(capture.data, 'base64'));
    console.log('CAPTURE', view.name);
  }
  await evaluate(`brickratDev.placeCamera(${JSON.stringify(summary.cameras.int_living_n)})`);
  summary.performance = [];
  for (let i = 0; i < 3; i++) summary.performance.push(await evaluate('brickratDev.benchmark(30)'));
  summary.materials = await evaluate(`(() => {
    const d = brickratDev, counts = {lightmaps:0, raw:0, uv1:0, glass:0, glassSky:0, oneSided:0, badOneSided:0, cloth:0};
    d.scene.traverse(m => { if (!m.isMesh) return; if (m.geometry.attributes.bakedSmooth) counts.cloth++;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (mat.lightMap) { counts.lightmaps++; if (mat.lightMap.colorSpace === '') counts.raw++; if (mat.lightMap.channel === 1) counts.uv1++; }
        if (mat.transmission > 0) { counts.glass++; if (mat.envMap && !mat.emissiveMap && !mat.lightMap) counts.glassSky++; }
        if (mat.name.includes('__1s')) { counts.oneSided++; if (mat.side !== 0) counts.badOneSided++; }
      }
    }); return {...counts, lights: d.scene.children.filter(n => n.isLight && n.visible).length, fog: !!d.scene.fog,
      programs: d.renderer.info.programs.map(p => ({runnable:p.diagnostics?.runnable, name:p.name}))}; })()`);
  console.log('PERFORMANCE', JSON.stringify(summary.performance));
  console.log('MATERIALS', JSON.stringify(summary.materials));
} catch (error) { summary.errors.push(error.message); console.error(error.message); process.exitCode = 1; }
finally {
  summary.browserErrors = events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
}
