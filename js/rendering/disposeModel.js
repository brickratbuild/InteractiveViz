export function disposeModel(model) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  model.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.material) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) { if (texture.source?.data) images.add(texture.source.data); texture.dispose(); }
  for (const image of images) image.close?.();
  for (const geometry of geometries) { geometry.disposeBoundsTree?.(); geometry.dispose(); }
}
