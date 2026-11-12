import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { browserSession, sleep } from './browser-session.mjs';

const registry = JSON.parse(await readFile(new URL('../customers.json', import.meta.url)));
const expected = registry.shareefa.startPosition;
const output = 'validation/spawn/configured';
const browser = await browserSession(output), results = [];
try {
  await browser.call('Emulation.setDeviceMetricsOverride', { width:960, height:600, deviceScaleFactor:1, mobile:false });
  // Exercise the new slug AND the existing development shortcut.
  for (const [quality, url] of [
    ['desktop', '/shareefa?quality=desktop'],
    ['mobile', '/local-validation?devModel=shareefa&quality=mobile'],
  ]) {
    await browser.call('Page.navigate', { url:`http://127.0.0.1:5173${url}` });
    let status;
    for (let i=0;i<800;i++) {
      await sleep(100); status = await browser.evaluate('window.brickratDev?.status()');
      if (status?.ready || status?.failed) break;
    }
    assert.ok(status?.ready, `${quality} must load`);
    assert.ok('configured starting position' in status.loadTimings);
    assert.ok(!('start-position scan' in status.loadTimings));
    const start = await browser.evaluate('brickratDev.getStartPosition()');
    assert.deepEqual(start, expected);
    const eyeY = await browser.evaluate('brickratDev.camera.position.y');
    assert.ok(Math.abs(eyeY - expected.y - 1.65) < 1e-8);
    // The reference's URL uses y=12.16 as a hint and casts from y+1.
    // Verify our stored feet height matches its actual resolved placement.
    const referenceFloor = await browser.evaluate(`(async () => {
      const T = await import('/lib/three/three.module.js');
      const ray = new T.Raycaster(new T.Vector3(43.92,13.16,-462.88),new T.Vector3(0,-1,0),0,400.45);
      ray.firstHitOnly = true;
      return ray.intersectObjects(brickratDev.controller._meshes,false)[0]?.point.y;
    })()`);
    assert.ok(Math.abs(referenceFloor - expected.y) < 0.001, 'stored start must match reference viewer floor placement');
    await sleep(450);
    await browser.evaluate("document.querySelectorAll('.overlay, #fpsCounter, #btnGhost, #crosshair, #escHint, #btnFullscreen').forEach(e => e.style.display = 'none')");
    const screenshot = await browser.call('Page.captureScreenshot', { format:'png' });
    await writeFile(`${output}/${quality}-start.png`, Buffer.from(screenshot.data,'base64'));
    const walked = await browser.evaluate(`(() => {
      const d = brickratDev, c = d.controller; c.isLocked = true;
      const floorHit = c._probeFloor(d.camera.position.x, d.camera.position.z);
      c.update(0); const settled = c.lastGroundY;
      c.keyState.KeyW = true; for(let i=0;i<60;i++) c.update(1/60);
      c.keyState.KeyW = false; const forward = d.getStartPosition();
      c.keyState.KeyS = true; for(let i=0;i<60;i++) c.update(1/60);
      c.keyState.KeyS = false; c.isLocked = false;
      return {floorHit, settled, forward, position:d.getStartPosition()};
    })()`);
    assert.ok(walked.floorHit !== null && Math.abs(walked.floorHit - expected.y) < 0.001, 'bookmark must be on the actual surface');
    assert.ok(Math.abs(walked.settled - expected.y) < 0.001, 'bookmark must settle on the intended surface');
    assert.ok(Math.abs(walked.position.y - expected.y) < 0.5, 'walking must stay inside the house floor level');
    assert.ok(Math.hypot(walked.position.x - start.x, walked.position.z - start.z) > 0.1, 'must be able to walk from the start');
    results.push({ quality, start, eyeY, referenceFloor, walked });
    console.log('PASS',quality,JSON.stringify(results.at(-1)));
  }
} catch (error) { results.push({error:error.stack}); console.error(error); process.exitCode = 1; }
finally { await writeFile(`${output}/results.json`,JSON.stringify(results,null,2)); await browser.close(); }
