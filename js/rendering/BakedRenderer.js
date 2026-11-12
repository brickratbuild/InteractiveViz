import * as THREE from '../../lib/three/three.module.js';
import { VIEW_LUT } from './view_lut_agx_mhc.js';
import { createBloom } from './bloom.js';
import { createSkyTexture, adaptBakedMaterials } from './bakedMaterials.js';

// Choose only sample counts advertised for BOTH half-float colour and depth.
export function supportedSamples(gl, requested) {
  if (!requested) return 0;
  const color = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) || []);
  // r174's default depth attachment (without a DepthTexture) is DEPTH_COMPONENT24.
  const depth = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) || []);
  return Math.max(0, ...color.filter(n => n <= requested && depth.includes(n)));
}

export class BakedRenderer {
  constructor(renderer, scene, model, contract, quality) {
    this.renderer = renderer; this.scene = scene; this.contract = contract;
    this.resources = []; this.lightStates = [];
    this.previous = { background: scene.background, backgroundIntensity: scene.backgroundIntensity,
      environment: scene.environment, fog: scene.fog, toneMapping: renderer.toneMapping,
      exposure: renderer.toneMappingExposure };
    this.diagnostics = { profile: contract.profile, encoding: contract.encoding, exposure: contract.exposure,
      quality: quality.name, samples: 0, shaderCompiles: 0, lightmap: 0, vertex: 0, glass: 0,
      unchanged: 0, singleSided: 0, clothVertices: 0 };
    try {
      const gl = renderer.getContext();
      if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
        throw new Error('Baked HDR rendering is unsupported on this device');
      }
      this.target = this.own(new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType, samples: supportedSamples(gl, quality.samples),
      }));
      this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      // Validate the actual framebuffer, and retry without MSAA if necessary.
      renderer.setRenderTarget(this.target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.target.samples) {
        this.target.dispose(); this.target.samples = 0; renderer.setRenderTarget(null); renderer.setRenderTarget(this.target);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Unable to create a linear HDR framebuffer');
      renderer.setRenderTarget(null);
      this.diagnostics.samples = this.target.samples;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1; // exposure belongs ONLY to the LUT pass
      scene.fog = null; scene.environment = null;
      scene.traverse(node => { if (node.isLight) { this.lightStates.push([node, node.visible]); node.visible = false; } });

      const sky = createSkyTexture(contract.sky);
      let glassEnv = null;
      if (sky) {
        this.own(sky); scene.background = sky;
        scene.backgroundIntensity = 1 / contract.exposure;
        const pmrem = new THREE.PMREMGenerator(renderer);
        try { glassEnv = this.own(pmrem.fromEquirectangular(sky)).texture; } finally { pmrem.dispose(); }
      } else {
        scene.background = new THREE.Color(0xB8CEDD).multiplyScalar(1 / contract.exposure);
        scene.backgroundIntensity = 1;
      }
      const start = performance.now();
      this.materials = adaptBakedMaterials(model, contract, quality, glassEnv, this.diagnostics, renderer.capabilities.getMaxAnisotropy());
      this.diagnostics.materialSetupMs = performance.now() - start;
      const n = VIEW_LUT.size, bytes = Uint8Array.from(atob(VIEW_LUT.data), c => c.charCodeAt(0));
      if (bytes.length !== n ** 3 * 3) throw new Error('Invalid Blender LUT payload');
      const rgba = new Uint8Array(n ** 3 * 4);
      for (let i = 0; i < n ** 3; i++) rgba.set([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2], 255], i * 4);
      const lut = this.own(new THREE.Data3DTexture(rgba, n, n, n));
      lut.minFilter = lut.magFilter = THREE.LinearFilter;
      lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
      lut.unpackAlignment = 1; lut.needsUpdate = true;
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.bloom = createBloom(renderer, this.camera, quality);
      const material = this.own(new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false, toneMapped: false,
        uniforms: { tScene: { value: this.target.texture }, tLut: { value: lut },
          tBloom: { value: this.bloom?.texture || this.target.texture }, exposure: { value: contract.exposure },
          lo: { value: VIEW_LUT.lo }, hi: { value: VIEW_LUT.hi }, size: { value: n }, aspect: { value: 1 }, frame: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        // The LUT already outputs display sRGB. No colorspace/tonemapping chunks or OutputPass here.
        fragmentShader: `precision highp sampler3D;
          uniform sampler2D tScene, tBloom; uniform sampler3D tLut;
          uniform float exposure, lo, hi, size, aspect, frame; varying vec2 vUv;
          float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
          void main() {
            vec3 c = texture2D(tScene, vUv).rgb;
            ${quality.bloom > 0 ? `c += ${(quality.bloom / 6).toFixed(5)} * texture2D(tBloom, vUv).rgb;` : ''}
            ${quality.vignette > 0 ? `vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
              float r2 = dot(d, d) / (0.25 * (aspect * aspect + 1.0));
              c *= 1.0 - ${quality.vignette.toFixed(5)} * r2 * r2 * (3.0 - 2.0 * r2);` : ''}
            c = max(c * exposure, vec3(1e-6));
            vec3 x = clamp((log2(c) - lo) / (hi - lo), 0.0, 1.0);
            vec3 o = texture(tLut, (x * (size - 1.0) + 0.5) / size).rgb;
            ${quality.grain > 0 ? `vec2 g = gl_FragCoord.xy + 37.0 * vec2(fract(frame * 0.6180339), fract(frame * 0.7548777)) * 100.0;
              float noise = h12(g) + h12(g + 71.3) - 1.0;
              o += noise * ${quality.grain.toFixed(5)} * (1.0 - 0.5 * dot(o, vec3(0.2126, 0.7152, 0.0722)));` : ''}
            gl_FragColor = vec4(o, 1.0);
          }`,
      }));
      this.postMaterial = material;
      this.postScene = new THREE.Scene();
      const quad = new THREE.Mesh(this.own(new THREE.PlaneGeometry(2, 2)), material);
      quad.frustumCulled = false; this.postScene.add(quad);
      this.resize();
    } catch (error) { this.dispose(); throw error; }
  }

  own(resource) { this.resources.push(resource); return resource; }

  resize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const gl = this.renderer.getContext();
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    if (size.x > limit || size.y > limit) throw new Error('Requested HDR framebuffer exceeds this device limit');
    this.target.setSize(size.x, size.y);
    this.bloom?.setSize(size.x, size.y);
    this.postMaterial.uniforms.aspect.value = size.x / size.y;
    try {
      this.renderer.setRenderTarget(this.target);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Unable to resize the HDR framebuffer');
      }
    } finally { this.renderer.setRenderTarget(null); }
  }

  render(camera) {
    const renderer = this.renderer;
    try {
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, camera);
      this.bloom?.render(this.target.texture, this.target.width, this.target.height, this.contract.exposure);
      this.postMaterial.uniforms.frame.value = (this.postMaterial.uniforms.frame.value + 1) % 4096;
      renderer.setRenderTarget(null);
      renderer.render(this.postScene, this.camera);
    } finally { renderer.setRenderTarget(null); }
  }

  dispose() {
    this.renderer.setRenderTarget(null);
    this.materials?.dispose(); this.materials = null;
    this.bloom?.dispose(); this.bloom = null;
    for (const resource of this.resources.splice(0)) resource.dispose();
    const p = this.previous;
    Object.assign(this.scene, { background: p.background, backgroundIntensity: p.backgroundIntensity, environment: p.environment, fog: p.fog });
    this.renderer.toneMapping = p.toneMapping; this.renderer.toneMappingExposure = p.exposure;
    for (const [light, visible] of this.lightStates.splice(0)) light.visible = visible;
  }
}
