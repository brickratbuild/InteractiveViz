// Old { name, modelUrl } records remain valid. Variants can carry their own
// rendering metadata; a missing variant falls back to the original asset.
export function normalizeStartPosition(value) {
  // Missing configuration preserves compatibility with older customer records.
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value) ||
      !['x', 'y', 'z'].every(key => Number.isFinite(value[key])) ||
      (value.yaw !== undefined && !Number.isFinite(value.yaw)) ||
      (value.pitch !== undefined && (!Number.isFinite(value.pitch) || Math.abs(value.pitch) > 75.6))) {
    throw new Error('Invalid startPosition: x/y/z must be finite numbers; yaw/pitch are degrees (pitch -75.6 to 75.6)');
  }
  return { x: value.x, y: value.y, z: value.z, yaw: value.yaw ?? 0, pitch: value.pitch ?? 0 };
}

export function selectCustomerModel(entry, quality) {
  if (!entry || typeof entry !== 'object') throw new Error('unknown-slug');
  const variant = entry.models?.[quality] ?? entry.modelUrl ?? entry.models?.desktop ?? entry.models?.mobile;
  const selected = typeof variant === 'string' ? { url: variant } : variant;
  if (!selected || typeof selected.url !== 'string' || !selected.url.trim()) throw new Error('unknown-slug');
  const normalize = value => typeof value === 'string' ? { profile: value } : value || {};
  return { url: selected.url, rendering: { ...normalize(entry.rendering), ...normalize(selected.rendering) },
    startPosition: normalizeStartPosition(Object.hasOwn(selected, 'startPosition') ? selected.startPosition : entry.startPosition) };
}

export async function resolveCustomerModel({ pathname, quality, development = false, fetchRegistry = fetch }) {
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('missing-slug');
  const response = await fetchRegistry('/customers.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('registry-unavailable');
  const customers = await response.json();
  const entry = Object.hasOwn(customers, slug) ? customers[slug] : null;
  if (entry?.developmentOnly && !development) throw new Error('unknown-slug');
  return selectCustomerModel(entry, quality);
}
