import * as THREE from '../../lib/three/three.module.js';
import { meshFlag } from './bakedContract.js';
import { installBakedShader } from './bakedShaders.js';
import { smoothCloth } from './cloth.js';

export function createSkyTexture(sky) {
  if (!sky) return null;
  if (sky.encoding !== 'rgb-float16-base64' || !Number.isInteger(sky.width) || !Number.isInteger(sky.height) ||
      sky.width <= 0 || sky.height <= 0 || sky.width * sky.height > 16_777_216 || typeof sky.data !== 'string') {
    throw new Error('Invalid baked sky metadata');
  }
  const bytes = Uint8Array.from(atob(sky.data), c => c.charCodeAt(0));
  const count = sky.width * sky.height;
  if (bytes.length !== count * 6) throw new Error('Baked sky payload size does not match dimensions');
  const data = new DataView(bytes.buffer), rgba = new Uint16Array(count * 4).fill(0x3c00);
  for (let i = 0; i < count; i++) for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = data.getUint16(i * 6 + ch * 2, true);
  const texture = new THREE.DataTexture(rgba, sky.width, sky.height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function adaptBakedMaterials(model, contract, quality, glassEnv, diagnostics, maxAnisotropy) {
  const materials = new Map(), lightmaps = new Map(), originals = [], geometries = new Set();
  const filterOriginals = new Map();
  const dispose = () => {
    for (const [mesh, material, geometry] of originals) { mesh.material = material; mesh.geometry = geometry; }
    for (const variants of materials.values()) for (const material of variants.values()) material.dispose();
    for (const texture of lightmaps.values()) texture.dispose();
    for (const geometry of geometries) { geometry.disposeBoundsTree?.(); geometry.dispose(); }
    for (const [texture, anisotropy] of filterOriginals) { texture.anisotropy = anisotropy; texture.needsUpdate = true; }
  };
  const namedVertex = mesh => {
    for (let node = mesh; node; node = node.parent) if (contract.vertexLitNodes.includes(node.name)) return true;
    return false;
  };
  model.updateMatrixWorld(true);
  try {
    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      const original = mesh.material, sourceList = Array.isArray(original) ? original : [original];
      originals.push([mesh, original, mesh.geometry]);
      const next = sourceList.map((source, index) => {
        const glass = source.transmission > 0;
        const vertex = !glass && !source.emissiveMap && !!mesh.geometry.attributes.color &&
          (meshFlag(mesh, 'vertex_lit') || meshFlag(mesh, 'vertex_lit_smooth') || namedVertex(mesh));
        const mode = glass ? 'glass' : source.emissiveMap ? 'lightmap' : vertex ? 'vertex' : 'unchanged';
        const soft = mode === 'vertex' && quality.cloth && meshFlag(mesh, 'vertex_lit_smooth') &&
          (source.roughness ?? 1) >= 0.5 && (source.metalness ?? 0) < 0.5 && !source.metalnessMap;
        if (soft) {
          if (!geometries.has(mesh.geometry)) {
            mesh.geometry = mesh.geometry.clone(); geometries.add(mesh.geometry);
          }
          diagnostics.clothVertices += smoothCloth(mesh, Array.isArray(original) ? index : null);
        }
        diagnostics[mode]++;
        if (source.name.includes('__1s')) diagnostics.singleSided++;
        let variants = materials.get(source);
        if (!variants) { variants = new Map(); materials.set(source, variants); }
        const key = `${mode}-${soft}`;
        if (mode === 'lightmap') {
          const channel = source.emissiveMap.channel;
          if (!mesh.geometry.getAttribute(channel === 0 ? 'uv' : `uv${channel}`)) {
            throw new Error(`Missing lightmap UV channel ${channel}: ${mesh.name}/${source.name}`);
          }
        }
        if (variants.has(key)) return variants.get(key);
        let mat;
        if (mode === 'vertex') {
          mat = new THREE.MeshStandardMaterial({
            name: source.name, map: source.map, color: source.color.clone(), vertexColors: true,
            roughness: source.roughness ?? 1, metalness: (source.metalness ?? 0) * 0.3,
            roughnessMap: source.roughnessMap, metalnessMap: source.metalnessMap,
            transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
            alphaMap: source.alphaMap, depthWrite: source.depthWrite,
          });
        } else mat = source.clone();
        variants.set(key, mat);
        mat.side = source.name.includes('__1s') ? THREE.FrontSide : THREE.DoubleSide;
        if (mode === 'lightmap') {
          if (source.emissiveMap.isCompressedTexture) throw new Error('Encoded baked lightmaps must not use colour-texture compression');
          if (!lightmaps.has(source.emissiveMap)) {
            const lm = source.emissiveMap.clone();
            // Older Shareefa sqrt exports stored sRGB(sqrt(E)); log codes and
            // explicit linear payloads are raw. Auto-detection only accepts log12.
            lm.colorSpace = contract.encoding === 'sqrt' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            lm.needsUpdate = true;
            lightmaps.set(source.emissiveMap, lm);
          }
          mat.lightMap = lightmaps.get(source.emissiveMap);
          mat.lightMapIntensity = Math.PI;
          mat.metalness *= 0.3;
          mat.envMap = null;
          installBakedShader(mat, { mode, encoding: contract.encoding, logStops: contract.logStops }, diagnostics);
        }
        if (mode === 'vertex') installBakedShader(mat, { mode, soft }, diagnostics);
        if (mode === 'glass' || mode === 'lightmap') {
          mat.emissiveMap = null; mat.emissive.setRGB(0, 0, 0); mat.emissiveIntensity = 0;
        }
        if (glass) {
          mat.lightMap = null;
          mat.envMap = glassEnv;
          mat.envMapIntensity = 1 / contract.exposure;
        }
        for (const slot of ['map', 'lightMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          const texture = mat[slot];
          if (!texture) continue;
          if (!filterOriginals.has(texture)) filterOriginals.set(texture, texture.anisotropy);
          texture.anisotropy = Math.min(quality.anisotropy, maxAnisotropy);
          texture.needsUpdate = true;
        }
        mat.needsUpdate = true;
        return mat;
      });
      mesh.material = Array.isArray(original) ? next : next[0];
    });
    return { dispose };
  } catch (error) { dispose(); throw error; }
}
