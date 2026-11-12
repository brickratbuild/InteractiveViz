import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import * as THREE from '../lib/three/three.module.js';
import { QUALITY_PRESETS, selectQuality } from '../js/rendering/quality.js';
import { selectCustomerModel, resolveCustomerModel, normalizeStartPosition } from '../js/models/customerConfig.js';
import { getStartView } from '../js/utils/modelStart.js';
import { readBakedContract } from '../js/rendering/bakedContract.js';
import { patchBakedShader, replaceExactly } from '../js/rendering/bakedShaders.js';
import { adaptBakedMaterials, createSkyTexture } from '../js/rendering/bakedMaterials.js';
import { supportedSamples } from '../js/rendering/BakedRenderer.js';

test('existing customer records, variants and missing-variant fallbacks', async () => {
  const customers = JSON.parse(await readFile(new URL('../customers.json', import.meta.url)));
  for (const entry of Object.values(customers).filter(entry => !entry.developmentOnly)) for (const quality of ['mobile', 'desktop']) {
    assert.equal(selectCustomerModel(entry, quality).url, entry.modelUrl);
  }
  const entry = { modelUrl: '/old.glb', rendering: 'legacy', models: {
    desktop: '/large.glb', mobile: { url: '/small.glb', rendering: { profile: 'shareefa-baked-v1', exposure: 7 } },
  } };
  assert.equal(selectCustomerModel(entry, 'mobile').rendering.exposure, 7);
  assert.equal(selectCustomerModel(entry, 'desktop').rendering.profile, 'legacy');
  assert.equal(selectCustomerModel({ modelUrl: '/old.glb', models: { desktop: '/large.glb' } }, 'mobile').url, '/old.glb');
  assert.equal(selectCustomerModel({ models: { desktop: '/large.glb' } }, 'mobile').url, '/large.glb');
  await assert.rejects(resolveCustomerModel({ pathname: '/', quality: 'mobile' }), /missing-slug/);
  await assert.rejects(resolveCustomerModel({ pathname: '/none', quality: 'mobile', fetchRegistry: async () => ({ ok: false }) }), /registry-unavailable/);
  await assert.rejects(resolveCustomerModel({ pathname: '/toString', quality: 'mobile', fetchRegistry: async () => ({ ok: true, json: async () => customers }) }), /unknown-slug/);
});

test('starting positions validate feet coordinates and inherit/override per variant', () => {
  const start = { x: 43.92, y: 12.16, z: -462.88, yaw: -85, pitch: 0 };
  const alternate = { x: 1, y: -2, z: 3 };
  const entry = { modelUrl: '/old.glb', startPosition: start, models: {
    desktop: '/large.glb', mobile: { url: '/small.glb', startPosition: alternate },
  } };
  assert.deepEqual(selectCustomerModel(entry, 'desktop').startPosition, start);
  assert.deepEqual(selectCustomerModel(entry, 'mobile').startPosition, { ...alternate, yaw: 0, pitch: 0 });
  assert.equal(selectCustomerModel({ modelUrl: '/old.glb' }, 'mobile').startPosition, null);
  for (const invalid of [{ x: 1, z: 3 }, { ...start, y: '12.16' }, { ...start, x: Infinity },
    { ...start, yaw: NaN }, { ...start, pitch: 90 }, 'auto']) {
    assert.throws(() => normalizeStartPosition(invalid), /Invalid startPosition/);
  }
  assert.equal(normalizeStartPosition({ ...start, pitch: 75.6 }).pitch, 75.6);
});

test('configured starts skip model scanning; older records retain automatic placement', () => {
  const view = getStartView(null, { x: 43.92, y: 12.16, z: -462.88, yaw: -85, pitch: 15 }, 1.65);
  assert.deepEqual(view.position.toArray(), [43.92, 13.81, -462.88]);
  assert.equal(view.yaw, THREE.MathUtils.degToRad(-85));
  assert.equal(view.pitch, THREE.MathUtils.degToRad(15));
  const model = new THREE.Group(), floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 10));
  floor.position.y = -0.25; model.add(floor); model.updateMatrixWorld(true);
  const fallback = getStartView(model, null, 1.65);
  assert.deepEqual(fallback.position.toArray(), [0, 1.65, 0]);
  assert.equal(fallback.yaw, 0);
  floor.geometry.dispose(); floor.material.dispose();
});

test('Shareefa config is local-only and uses the documented viewer bookmark for both GLBs', async () => {
  const customers = JSON.parse(await readFile(new URL('../customers.json', import.meta.url)));
  const fetchRegistry = async () => ({ ok: true, json: async () => customers });
  await assert.rejects(resolveCustomerModel({ pathname: '/shareefa', quality: 'desktop', fetchRegistry }), /unknown-slug/);
  for (const quality of ['desktop', 'mobile']) {
    const selected = await resolveCustomerModel({ pathname: '/shareefa', quality, development: true, fetchRegistry });
    assert.equal(selected.url, `/__reference/${quality}.glb`);
    assert.deepEqual(selected.startPosition, { x: 43.92, y: 12.5, z: -462.88, yaw: -85, pitch: 0 });
  }
});

test('quality selection keeps overrides local and defaults conservatively', () => {
  assert.equal(selectQuality({ coarse: true }).name, 'mobile');
  assert.equal(selectQuality({ memory: 4 }).name, 'mobile');
  assert.equal(selectQuality({ override: 'mobile' }).name, 'desktop');
  assert.equal(selectQuality({ development: true, override: 'mobile' }).name, 'mobile');
  assert.equal(QUALITY_PRESETS.mobile.samples, 0);
});

test('unrelated emissive and vertex assets do not opt in; explicit encoding/exposure validated', () => {
  const model = new THREE.Group();
  model.userData = { lightmap_encoding: 'log12', viewer_exposure: 9 };
  assert.equal(readBakedContract(model), null);
  const contract = readBakedContract(model, { profile: 'shareefa-baked-v1' });
  assert.equal(contract.exposure, 9);
  assert.equal(readBakedContract(model, { profile: 'legacy' }), null);
  assert.equal(readBakedContract(model, { profile: 'shareefa-baked-v1', encoding: 'linear', exposure: 3 }).exposure, 3);
  assert.throws(() => readBakedContract(model, { profile: 'shareefa-baked-v1', exposure: 0 }), /exposure/);
  assert.throws(() => readBakedContract(model, { profile: 'shareefa-baked-v1', logStops: 8 }), /log stops/);
});

test('patches match vendored r174 and fail loudly for changed targets', () => {
  assert.equal(THREE.REVISION, '174');
  for (const options of [{ mode: 'lightmap', encoding: 'log12', logStops: 12 }, { mode: 'vertex' }, { mode: 'vertex', soft: true }]) {
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    patchBakedShader(shader, options);
    assert.match(shader.fragmentShader, /radiance \+=/);
    if (options.mode === 'lightmap') assert.match(shader.fragmentShader, /exp2\(lightMapTexel.rgb \* 12.0 - 12.0\)/);
  }
  assert.throws(() => replaceExactly('absent', 'target', '', 'test'), /found 0/);
  assert.throws(() => replaceExactly('targettarget', 'target', '', 'test'), /found 2/);
});

test('material adaptation isolates shared sources, respects UVs, glass, __1s and metadata', () => {
  const group = new THREE.Group(), texture = new THREE.Texture();
  texture.channel = 1; texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('uv1', geometry.attributes.uv.clone());
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(0.2), 3));
  const source = new THREE.MeshStandardMaterial({ emissiveMap: texture, metalness: 0.8, name: 'wall__1s' });
  const lightmapped = new THREE.Mesh(geometry, source); group.add(lightmapped);
  const glass = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ transmission: 1, emissiveMap: texture })); group.add(glass);
  const vertexMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
  const vertex = new THREE.Mesh(geometry, vertexMaterial); vertex.userData = { vertex_lit: true, vertex_lit_smooth: true }; group.add(vertex);
  const tint = new THREE.Mesh(geometry, vertexMaterial); group.add(tint);
  const stats = { shaderCompiles: 0, lightmap: 0, vertex: 0, glass: 0, unchanged: 0, singleSided: 0, clothVertices: 0 };
  const resources = adaptBakedMaterials(group, { encoding: 'log12', logStops: 12, exposure: 9, vertexLitNodes: [] }, QUALITY_PRESETS.desktop, null, stats, 16);
  assert.equal(lightmapped.material.lightMap.channel, 1);
  assert.equal(lightmapped.material.lightMap.colorSpace, THREE.NoColorSpace);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(lightmapped.material.lightMapIntensity, Math.PI);
  assert.equal(lightmapped.material.side, THREE.FrontSide);
  assert.equal(lightmapped.material.metalness, 0.24);
  assert.equal(glass.material.emissiveMap, null); assert.equal(glass.material.lightMap, null);
  assert.equal(glass.material.envMapIntensity, 1 / 9);
  assert.notEqual(vertex.material, tint.material);
  assert.ok(vertex.geometry.attributes.bakedSmooth);
  assert.equal(tint.geometry.attributes.bakedSmooth, undefined);
  resources.dispose();
  assert.equal(lightmapped.material, source); assert.equal(vertex.geometry, geometry);
});

test('HDR sample support intersects colour and depth formats; malformed sky is rejected', () => {
  const gl = { RENDERBUFFER: 1, RGBA16F: 2, DEPTH_COMPONENT24: 3, SAMPLES: 4,
    getInternalformatParameter: (_, format) => format === 2 ? [8, 4, 2] : [8, 2] };
  assert.equal(supportedSamples(gl, 4), 2);
  assert.equal(supportedSamples(gl, 0), 0);
  assert.throws(() => createSkyTexture({ encoding: 'rgb-float16-base64', width: 2, height: 2, data: '' }), /payload size/);
});

for (const name of ['interior_hyb_log12_g21.glb', 'interior_mobile_m3.glb']) {
  test(`supplied ${name} contract metadata (read only)`, async t => {
    const url = new URL(`../../shareefa_walkthrough_2026-11-11/v13/latest/exports/${name}`, import.meta.url);
    let file;
    try { file = await open(url, 'r'); } catch (e) { if (e.code === 'ENOENT') return t.skip('Reference package not installed'); throw e; }
    try {
      const header = Buffer.alloc(20); await file.read(header, 0, 20, 0);
      assert.equal(header.toString('ascii', 0, 4), 'glTF');
      const bytes = Buffer.alloc(header.readUInt32LE(12)); await file.read(bytes, 0, bytes.length, 20);
      const json = JSON.parse(bytes), model = new THREE.Group(); model.userData = json.scenes[json.scene || 0].extras;
      for (const node of json.nodes) { const child = new THREE.Group(); child.userData = node.extras || {}; model.add(child); }
      const contract = readBakedContract(model);
      assert.equal(contract.encoding, 'log12'); assert.equal(contract.exposure, model.userData.lut_exposure);
      const sky = createSkyTexture(contract.sky); assert.equal(sky.image.width, 256); sky.dispose();
      assert.ok(json.materials.filter(m => m.emissiveTexture).every(m => m.emissiveTexture.texCoord === 1));
    } finally { await file.close(); }
  });
}
