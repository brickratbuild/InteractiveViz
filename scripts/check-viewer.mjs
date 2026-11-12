import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { browserSession, sleep } from './browser-session.mjs';

const mobile = process.argv[2] === 'mobile';
const output = `validation/controls-${mobile ? 'mobile' : 'desktop'}`;
const browser = await browserSession(output);
const { call, evaluate } = browser;
const results = { mobile, checks: [] };
const check = (name, value) => { assert.ok(value, name); results.checks.push(name); console.log('PASS', name); };
const until = async (expression, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await evaluate(expression); if (result) return result; await sleep(100); }
  throw new Error(`Timed out: ${expression}`);
};
try {
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await call('Page.navigate', { url: `http://127.0.0.1:5173/local-validation?devModel=shareefa&devVariant=mobile${mobile ? '' : '&quality=mobile'}` });
  await until('window.brickratDev?.status().ready');
  await sleep(500);
  check('loading overlay yields to ready prompt', await evaluate("getComputedStyle(document.getElementById('loadingOverlay')).display === 'none' && getComputedStyle(document.getElementById('clickPrompt')).display === 'flex'"));
  check('correct control mode, independent of quality override', await evaluate(`!!brickratDev.controller._mobile === ${mobile}`));
  if (mobile) check('automatic mobile preset selected', await evaluate("brickratDev.status().quality.name === 'mobile'"));
  results.loadedModel = await evaluate('brickratDev.status()');
  await evaluate(`(async () => {
    const T = await import('/lib/three/three.module.js'), d = brickratDev;
    const fixture = new T.Group(), material = new T.MeshStandardMaterial({side:T.DoubleSide});
    const floor = new T.Mesh(new T.BoxGeometry(20,0.5,20), material); floor.position.y = -0.25;
    const wall = new T.Mesh(new T.BoxGeometry(10,3,0.1), material); wall.position.set(0,1.5,-1);
    fixture.add(floor,wall); d.scene.add(fixture); fixture.updateMatrixWorld(true); d.controller.setScene(fixture);
    window.controlFixture = fixture; d.placeCamera({x:0,y:1.65,z:0,yaw:0,pitch:0,fov:88});
  })()`);
  if (mobile) {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x:420,y:195,id:1}] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await call('Runtime.evaluate', { expression:'document.getElementById("clickPrompt").click()', userGesture:true });
  }
  let nativePointerLock = false;
  if (mobile) {
    await until('brickratDev.controller.isLocked');
    check('tap-to-explore activates controller', true);
  } else {
    try { await until('brickratDev.controller.isLocked', 1500); nativePointerLock = true; }
    catch {
      results.limitations = ['This headless Chrome rejects native pointer lock with WrongDocumentError. Keyboard/mouse controller tests below use isLocked=true; a visible-browser pointer-lock check remains.'];
      await evaluate('brickratDev.controller.isLocked = true; document.getElementById("clickPrompt").style.display = "none"');
      console.log('LIMITATION native pointer lock unavailable in headless Chrome');
    }
    if (nativePointerLock) check('desktop click acquires pointer lock', true);
  }
  if (mobile) {
    await call('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:100,y:270,id:1}] });
    await call('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:100,y:190,id:1}] });
  } else await call('Input.dispatchKeyEvent', { type:'keyDown', code:'KeyW', key:'w', windowsVirtualKeyCode:87 });
  const wallZ = await evaluate('(() => { for(let i=0;i<90;i++) brickratDev.controller.update(1/60); return brickratDev.camera.position.z; })()');
  results.wallZ = wallZ;
  check('wall collision blocks forward movement', wallZ > -0.8 && wallZ < -0.3);
  check('floor holds eye height', await evaluate('Math.abs(brickratDev.camera.position.y - 1.65) < 0.001'));
  if (mobile) await call('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  else await call('Input.dispatchKeyEvent', { type:'keyUp', code:'KeyW', key:'w', windowsVirtualKeyCode:87 });
  await evaluate("document.getElementById('btnGhost').click()");
  check('ghost button disables wall collision', await evaluate('!brickratDev.controller.wallCollisionEnabled'));
  if (mobile) {
    await call('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:100,y:270,id:1}] });
    await call('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:100,y:190,id:1}] });
  } else await call('Input.dispatchKeyEvent', { type:'keyDown', code:'KeyW', key:'w', windowsVirtualKeyCode:87 });
  const ghostZ = await evaluate('(() => { for(let i=0;i<90;i++) brickratDev.controller.update(1/60); return brickratDev.camera.position.z; })()');
  results.ghostZ = ghostZ; check('ghost movement passes through wall', ghostZ < -1.5);
  if (mobile) await call('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  else await call('Input.dispatchKeyEvent', { type:'keyUp', code:'KeyW', key:'w', windowsVirtualKeyCode:87 });
  await until('brickratDev.controller.wallCollisionEnabled', 5000);
  check('ghost collision returns after three seconds', true);
  if (mobile) {
    const yaw = await evaluate('brickratDev.controller.yaw');
    await call('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:650,y:180,id:2}] });
    await call('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:710,y:200,id:2}] });
    await sleep(150);
    await call('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    check('right-side touch drag changes look direction', await evaluate(`brickratDev.controller.yaw !== ${yaw}`));
    check('touch release clears joystick', await evaluate('brickratDev.controller._mobile.getMoveInput().z === 0'));
    await call('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:2,mobile:true,screenOrientation:{type:'portraitPrimary',angle:0} });
    await sleep(500);
    results.portrait = await evaluate('({aspect:brickratDev.camera.aspect, canvas:[brickratDev.renderer.domElement.width,brickratDev.renderer.domElement.height],rotate:getComputedStyle(document.getElementById("rotatePrompt")).display})');
    check('portrait orientation resizes HDR/camera and shows rotate hint', Math.abs(results.portrait.aspect - 390/844) < 0.01 && results.portrait.rotate !== 'none');
    await call('Emulation.setDeviceMetricsOverride', { width:844,height:390,deviceScaleFactor:2,mobile:true,screenOrientation:{type:'landscapePrimary',angle:90} });
    await sleep(500);
    check('landscape orientation restores viewport', await evaluate('Math.abs(brickratDev.camera.aspect - 844/390) < 0.01 && getComputedStyle(document.getElementById("rotatePrompt")).display === "none"'));
  } else {
    const yaw = await evaluate('brickratDev.controller.yaw');
    await evaluate("document.dispatchEvent(new MouseEvent('mousemove', {movementX:25, movementY:10}))");
    check('mouse look changes yaw', await evaluate(`brickratDev.controller.yaw !== ${yaw}`));
    await call('Input.dispatchKeyEvent', { type:'keyDown', code:'Space', key:' ', windowsVirtualKeyCode:32 });
    check('space shortcut activates ghost mode', await evaluate('!brickratDev.controller.wallCollisionEnabled'));
    await call('Input.dispatchKeyEvent', { type:'keyUp', code:'Space', key:' ', windowsVirtualKeyCode:32 });
    if (nativePointerLock) await evaluate('document.exitPointerLock()');
    else await evaluate('document.dispatchEvent(new Event("pointerlockchange"))');
    await until('!brickratDev.controller.isLocked');
    check('pointer-unlock event restores explore prompt', await evaluate('getComputedStyle(document.getElementById("clickPrompt")).display === "flex"'));
    await call('Emulation.setDeviceMetricsOverride', { width:1200,height:800,deviceScaleFactor:1,mobile:false });
    await sleep(500);
    check('desktop resize updates camera and renderer', await evaluate('brickratDev.camera.aspect === 1.5 && brickratDev.renderer.domElement.width === 1200'));
  }
  check('rendering remains healthy after controls and resize', await evaluate('brickratDev.status().ready && !brickratDev.status().failed'));
  await call('Page.navigate', { url:'http://127.0.0.1:5173/no-such-customer' });
  await until('document.getElementById("progressText")?.textContent === "Link not found"');
  check('unknown customer shows existing link error', true);
  await call('Page.navigate', { url:'http://127.0.0.1:5173/' });
  await until('document.getElementById("progressText")?.textContent === "Link not found"');
  check('missing slug shows existing link error', true);

  // Intercept only this local tab's registry to exercise an unavailable GLB.
  browser.onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return;
    call('Fetch.fulfillRequest', { requestId:event.params.requestId, responseCode:200,
      responseHeaders:[{name:'Content-Type',value:'application/json'}],
      body:Buffer.from(JSON.stringify({broken:{modelUrl:'/__reference/missing.glb'}})).toString('base64') }).catch(console.error);
  });
  await call('Fetch.enable', { patterns:[{urlPattern:'*/customers.json'}] });
  await call('Page.navigate', { url:'http://127.0.0.1:5173/broken' });
  await until('document.getElementById("progressText")?.textContent === "Model failed to load"');
  check('failed GLB remains on loading/error screen', await evaluate('getComputedStyle(document.getElementById("clickPrompt")).display === "none"'));
} catch (error) { results.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  results.browserErrors = browser.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  await writeFile(`${output}/results.json`, JSON.stringify(results,null,2)); await browser.close();
}
