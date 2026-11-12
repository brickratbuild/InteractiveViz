// Adapted from the supplied Shareefa v22 HDR bloom (no reflection probes).
import * as THREE from '../../lib/three/three.module.js';
const glslF = x => x.toFixed(5);
export function createBloom(renderer, viewCam, quality) {
  const BLOOM = quality.bloom, BLOOM_TH = quality.bloomThreshold;
  if (!(BLOOM > 0)) return null;
  const L = 6, rts = [], quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), sc = new THREE.Scene();
  quad.frustumCulled = false; sc.add(quad);
  for (let i = 0; i < L; i++) rts.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  const vs = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const down = (pre) => new THREE.ShaderMaterial({ vertexShader: vs, depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, exposure: { value: 1 } },
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 texel; uniform float exposure; varying vec2 vUv;
      vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * texel).rgb; }
      ${pre ? `vec3 pf(vec3 c) {   // threshold with a soft knee
        vec3 e = c * exposure; float b = max(e.r, max(e.g, e.b)), k = ${glslF(BLOOM_TH * 0.5)};
        float sk = clamp(b - ${glslF(BLOOM_TH)} + k, 0.0, 2.0 * k); sk = sk * sk / (4.0 * k + 1e-5);
        return c * max(sk, b - ${glslF(BLOOM_TH)}) / max(b, 1e-5) * min(1.0, 64.0 / max(b, 1e-5));   // clamp fireflies
      }` : 'vec3 pf(vec3 c) { return c; }'}
      void main() {
        vec3 a = pf(s(vec2(-1.0, -1.0))) + pf(s(vec2(1.0, -1.0))) + pf(s(vec2(-1.0, 1.0))) + pf(s(vec2(1.0, 1.0)));
        vec3 b = pf(s(vec2(-2.0, -2.0))) + pf(s(vec2(0.0, -2.0))) + pf(s(vec2(2.0, -2.0))) + pf(s(vec2(-2.0, 0.0)))
               + pf(s(vec2(2.0, 0.0))) + pf(s(vec2(-2.0, 2.0))) + pf(s(vec2(0.0, 2.0))) + pf(s(vec2(2.0, 2.0)));
        gl_FragColor = vec4(a * 0.125 + b * 0.0625 + pf(s(vec2(0.0))) * 0.125, 1.0);
      }` });
  const mPre = down(true), mDown = down(false);
  const mUp = new THREE.ShaderMaterial({ vertexShader: vs, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, transparent: true,
    uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
      void main() {
        vec3 c = 4.0 * texture2D(tSrc, vUv).rgb;
        c += 2.0 * (texture2D(tSrc, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(texel.x, 0.0)).rgb
                  + texture2D(tSrc, vUv + vec2(0.0, texel.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, texel.y)).rgb);
        c += texture2D(tSrc, vUv + texel).rgb + texture2D(tSrc, vUv - texel).rgb
           + texture2D(tSrc, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(tSrc, vUv + vec2(-texel.x, texel.y)).rgb;
        gl_FragColor = vec4(c / 16.0, 1.0);
      }` });
  const pass = (mat, src, srcW, srcH, dst) => {
    mat.uniforms.tSrc.value = src; mat.uniforms.texel.value.set(1 / srcW, 1 / srcH);
    quad.material = mat; renderer.setRenderTarget(dst); renderer.render(sc, viewCam);
  };
  return {
    texture: rts[0].texture,
    dispose() { rts.forEach(r => r.dispose()); mPre.dispose(); mDown.dispose(); mUp.dispose(); quad.geometry.dispose(); },
    setSize(w, h) { rts.forEach((r, i) => r.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)))); },
    render(src, w, h, exposure) {
      mPre.uniforms.exposure.value = exposure;
      pass(mPre, src, w, h, rts[0]);
      for (let i = 1; i < L; i++) pass(mDown, rts[i - 1].texture, rts[i - 1].width, rts[i - 1].height, rts[i]);
      const ac = renderer.autoClear; renderer.autoClear = false;
      try { for (let i = L - 2; i >= 0; i--) pass(mUp, rts[i + 1].texture, rts[i + 1].width, rts[i + 1].height, rts[i]);
      } finally { renderer.autoClear = ac; }
    },
  };
}
