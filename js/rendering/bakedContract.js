export const BAKED_PROFILE = 'shareefa-baked-v1';
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function meshFlag(mesh, flag) {
  for (let node = mesh; node; node = node.parent) if (node.userData?.[flag] === true) return true;
  return false;
}

export function readBakedContract(model, config = {}) {
  const profile = config.profile || 'auto';
  if (profile === 'legacy') return null;
  if (!['auto', BAKED_PROFILE].includes(profile)) throw new Error(`Unknown rendering profile: ${profile}`);
  const extras = model.userData || {};
  let taggedVertices = false;
  model.traverse(node => { if (node.userData?.vertex_lit === true) taggedVertices = true; });
  // Emissive textures, COLOR_0 or a filename alone never opt an asset in.
  const signature = extras.lightmap_encoding === 'log12' && positive(extras.lut_exposure) &&
    extras.sky_equirect?.encoding === 'rgb-float16-base64' && taggedVertices;
  if (profile === 'auto' && !signature) return null;

  const encoding = config.encoding ?? extras.lightmap_encoding;
  const exposure = config.exposure ?? extras.lut_exposure ?? extras.viewer_exposure;
  const logMatch = /^log(\d+)$/.exec(encoding || '');
  const logStops = logMatch ? (config.logStops ?? extras.lightmap_log_stops ?? Number(logMatch[1])) : 0;
  if (!['linear', 'sqrt'].includes(encoding) && !logMatch) throw new Error(`Unsupported baked encoding: ${encoding}`);
  if (logMatch && (!positive(logStops) || logStops > 24 || logStops !== Number(logMatch[1]))) {
    throw new Error('Inconsistent baked lightmap log stops');
  }
  if (!positive(exposure)) throw new Error('Baked model needs a positive calibrated exposure');
  if (config.vertexLitNodes && (!Array.isArray(config.vertexLitNodes) || config.vertexLitNodes.some(n => typeof n !== 'string'))) {
    throw new Error('vertexLitNodes must be a list of node names');
  }
  return { profile: BAKED_PROFILE, encoding, logStops, exposure, sky: extras.sky_equirect,
    vertexLitNodes: config.vertexLitNodes || [], softMaterials: extras.soft_lm_materials || [] };
}
