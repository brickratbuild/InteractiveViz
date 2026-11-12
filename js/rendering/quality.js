// Rendering quality is independent of navigation/input detection.
export const QUALITY_PRESETS = Object.freeze({
  mobile: Object.freeze({ name: 'mobile', pixelRatio: 1.25, samples: 0,
    anisotropy: 1, cloth: false, bloom: 0, bloomThreshold: 2,
    vignette: 0, grain: 0, reflectionProbes: false }),
  desktop: Object.freeze({ name: 'desktop', pixelRatio: 2, samples: 4,
    anisotropy: 16, cloth: true, bloom: 0.05, bloomThreshold: 2,
    vignette: 0.10, grain: 0, reflectionProbes: false }),
});

export function isLocalDevelopment(hostname = globalThis.location?.hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function selectQuality({ coarse = false, smallScreen = false, memory,
  override, development = false } = {}) {
  if (development && Object.hasOwn(QUALITY_PRESETS, override)) return QUALITY_PRESETS[override];
  return QUALITY_PRESETS[coarse || smallScreen || (memory > 0 && memory <= 4) ? 'mobile' : 'desktop'];
}
