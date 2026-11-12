import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { browserSession, sleep } from './browser-session.mjs';

const origin = 'http://127.0.0.1:4173';
const results = { paths: [], ready: null };
for (const file of ['customers.json','manifest.json','images/logo_round.png',
  'lib/three/libs/draco/gltf/draco_wasm_wrapper.js','lib/three/libs/draco/gltf/draco_decoder.wasm',
  'lib/three/libs/basis/basis_transcoder.js','lib/three/libs/basis/basis_transcoder.wasm','sw.js']) {
  const response = await fetch(`${origin}/${file}`);
  assert.equal(response.status, 200, file);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.equals(await readFile(file)), `${file} differs from source or is SPA HTML`);
  results.paths.push(file);
}
const html = await (await fetch(`${origin}/build-test`)).text();
assert.ok(html.includes('href="/manifest.json"'));
const browser = await browserSession('validation/build');
const configuredStart = JSON.parse(await readFile('customers.json')).shareefa.startPosition;
try {
  // Local tab-only fixture mapping: production registry itself is never edited.
  const model = (await readFile(new URL('../../shareefa_walkthrough_2026-11-11/v13/latest/exports/interior_mobile_m3.glb', import.meta.url))).toString('base64');
  browser.onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return;
    const registry = event.params.request.url.endsWith('/customers.json');
    browser.call('Fetch.fulfillRequest', { requestId:event.params.requestId, responseCode:200,
      responseHeaders:[{name:'Content-Type',value:registry ? 'application/json' : 'model/gltf-binary'}],
      body:registry ? Buffer.from(JSON.stringify({'build-test':{modelUrl:'/__testmodel.glb',startPosition:configuredStart}})).toString('base64') : model,
    }).catch(console.error);
  });
  await browser.call('Fetch.enable', { patterns:[{urlPattern:'*/customers.json'},{urlPattern:'*/__testmodel.glb'}] });
  await browser.call('Page.navigate', { url:`${origin}/build-test?quality=mobile` });
  for (let i=0;i<400;i++) {
    await sleep(100); results.ready = await browser.evaluate('window.brickratDev?.status()');
    if (results.ready?.ready || results.ready?.failed) break;
  }
  assert.ok(results.ready?.ready, JSON.stringify(results.ready));
  assert.equal(results.ready.diagnostics.profile,'shareefa-baked-v1');
  assert.equal(results.ready.diagnostics.lightmap,1001);
  results.startPosition = await browser.evaluate('brickratDev.getStartPosition()');
  assert.deepEqual(results.startPosition,configuredStart);
  console.log('PASS production bundle loads baked GLB at configured start through customer slug; stable runtime assets match source');
} finally { await writeFile('validation/build/results.json',JSON.stringify(results,null,2)); await browser.close(); }
