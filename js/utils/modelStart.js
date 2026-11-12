import * as THREE from '../../lib/three/three.module.js';
import { findStartPosition } from './findStartPosition.js';

// Configured coordinates are world-space feet positions; angles are degrees.
// No bounding-box or raycast search is performed when a start is provided.
export function getStartView(model, startPosition, eyeHeight) {
  if (startPosition) {
    return {
      position: new THREE.Vector3(startPosition.x, startPosition.y + eyeHeight, startPosition.z),
      yaw: THREE.MathUtils.degToRad(startPosition.yaw),
      pitch: THREE.MathUtils.degToRad(startPosition.pitch),
    };
  }

  // Backward-compatible fallback only for records without startPosition.
  const position = findStartPosition(model, eyeHeight);
  const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  const toCenter = new THREE.Vector3(centre.x - position.x, 0, centre.z - position.z);
  return { position, yaw: toCenter.lengthSq() > 0.001 ? Math.atan2(toCenter.x, toCenter.z) : 0, pitch: 0 };
}
