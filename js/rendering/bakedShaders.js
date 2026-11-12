import * as THREE from '../../lib/three/three.module.js';

export function replaceExactly(source, target, replacement, label) {
  const count = source.split(target).length - 1;
  if (count !== 1) throw new Error(`Baked shader patch ${label}: expected one target, found ${count} (Three r${THREE.REVISION})`);
  return source.replace(target, replacement);
}

export function patchBakedShader(shader, { mode, encoding, logStops, soft = false }) {
  let fs = shader.fragmentShader;
  if (mode === 'lightmap') {
    let chunk = THREE.ShaderChunk.lights_fragment_maps;
    const fetch = 'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );';
    const decode = encoding === 'sqrt' ? 'lightMapTexel.rgb *= lightMapTexel.rgb;' :
      logStops ? `lightMapTexel.rgb = exp2(lightMapTexel.rgb * ${logStops.toFixed(1)} - ${logStops.toFixed(1)});` : '';
    chunk = replaceExactly(chunk, fetch, `${fetch}\n${decode}`, 'lightmap decode');
    chunk = replaceExactly(chunk, 'irradiance += lightMapIrradiance;',
      'iblIrradiance += lightMapIrradiance; radiance += lightMapIrradiance * RECIPROCAL_PI;', 'baked specular');
    fs = replaceExactly(fs, '#include <lights_fragment_maps>', chunk, 'lightmap chunk');
  } else if (mode === 'vertex') {
    // COLOR_0 is irradiance, not albedo. Preserve optional vertex alpha.
    fs = replaceExactly(fs, '#include <color_fragment>',
      '#ifdef USE_COLOR_ALPHA\n diffuseColor.a *= vColor.a;\n#endif', 'vertex lighting');
    fs = replaceExactly(fs, '#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      iblIrradiance += PI * vColor.rgb;
      radiance += ${soft ? 'mix(vColor.rgb, clamp(vBakedSmooth, vColor.rgb, 2.0 * vColor.rgb), 0.5)' : 'vColor.rgb'};`, 'vertex specular');
    if (soft) {
      shader.vertexShader = replaceExactly(shader.vertexShader, 'void main() {',
        'attribute vec3 bakedSmooth; varying vec3 vBakedSmooth;\nvoid main() {', 'cloth attribute');
      shader.vertexShader = replaceExactly(shader.vertexShader, '#include <project_vertex>',
        '#include <project_vertex>\nvBakedSmooth = bakedSmooth;', 'cloth varying');
      fs = replaceExactly(fs, 'void main() {', 'varying vec3 vBakedSmooth;\nvoid main() {', 'cloth fragment');
    }
  } else throw new Error(`Unknown baked shader mode: ${mode}`);
  shader.fragmentShader = fs;
}

export function installBakedShader(material, options, diagnostics) {
  if (!material.isMeshStandardMaterial) throw new Error(`Baked material ${material.name} must use a standard/physical shader`);
  // Verify against the actual vendored revision now, before the first draw.
  patchBakedShader({ vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader }, options);
  material.onBeforeCompile = shader => {
    patchBakedShader(shader, options);
    diagnostics.shaderCompiles++;
  };
  material.customProgramCacheKey = () => `brickrat-baked-v1-r${THREE.REVISION}-${JSON.stringify(options)}`;
  material.needsUpdate = true;
}
