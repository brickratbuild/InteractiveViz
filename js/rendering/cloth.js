import * as THREE from '../../lib/three/three.module.js';

// Shareefa v22: load-time, luminance^4 weighted light on a 0.3 m world grid.
// Work per primitive/material so nearby fabrics never share lighting samples.
export function smoothCloth(mesh, materialIndex = null) {
  const geometry = mesh.geometry, p = geometry.attributes.position, c = geometry.attributes.color;
  const cells = new Map(), point = new THREE.Vector3(), positions = new Float32Array(p.count * 3);
  const out = geometry.attributes.bakedSmooth?.array || new Float32Array(p.count * 3);
  const vertices = new Set();
  if (materialIndex === null) for (let i = 0; i < p.count; i++) vertices.add(i);
  else for (const group of geometry.groups.filter(g => g.materialIndex === materialIndex)) {
    for (let i = group.start; i < group.start + group.count; i++) vertices.add(geometry.index ? geometry.index.getX(i) : i);
  }
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const i of vertices) {
    point.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).divideScalar(0.3).addScalar(2048);
    positions.set([point.x, point.y, point.z], i * 3);
    const k = key(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z));
    const cell = cells.get(k) || [0, 0, 0, 0];
    const r = c.getX(i), g = c.getY(i), b = c.getZ(i);
    const weight = (0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-6) ** 4;
    cell[0] += weight * r; cell[1] += weight * g; cell[2] += weight * b; cell[3] += weight;
    cells.set(k, cell);
  }
  for (const i of vertices) {
    const x = positions[i * 3] - 0.5, y = positions[i * 3 + 1] - 0.5, z = positions[i * 3 + 2] - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    let r = 0, g = 0, b = 0, sum = 0;
    for (let d = 0; d < 8; d++) {
      const dx = d & 1, dy = (d >> 1) & 1, dz = (d >> 2) & 1;
      const cell = cells.get(key(ix + dx, iy + dy, iz + dz));
      if (!cell) continue;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      r += w * cell[0] / cell[3]; g += w * cell[1] / cell[3]; b += w * cell[2] / cell[3]; sum += w;
    }
    out.set(sum > 1e-6 ? [r / sum, g / sum, b / sum] : [c.getX(i), c.getY(i), c.getZ(i)], i * 3);
  }
  geometry.setAttribute('bakedSmooth', new THREE.BufferAttribute(out, 3));
  return vertices.size;
}
