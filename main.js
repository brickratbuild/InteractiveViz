import * as THREE from './lib/three/three.module.js';
import { GLTFLoader } from './lib/three/loaders/GLTFLoader.js';
import { DRACOLoader } from './lib/three/loaders/DRACOLoader.js';
import { KTX2Loader } from './lib/three/loaders/KTX2Loader.js';
import { FirstPersonController } from './js/controls/FirstPersonControls.js';
import { MobileControls } from './js/controls/MobileControls.js';
import { getStartView } from './js/utils/modelStart.js';
import { selectQuality, isLocalDevelopment } from './js/rendering/quality.js';
import { resolveCustomerModel } from './js/models/customerConfig.js';
import { readBakedContract } from './js/rendering/bakedContract.js';
import { disposeModel } from './js/rendering/disposeModel.js';

// ============================================================
//  Device detection
// ============================================================
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const development = isLocalDevelopment();
const params = new URLSearchParams(window.location.search);
const quality = selectQuality({ coarse: matchMedia('(pointer: coarse)').matches,
  smallScreen: Math.min(screen.width, screen.height) <= 768, memory: navigator.deviceMemory,
  development, override: params.get('quality') });
let renderPipeline = null;
let modelRoot = null;
let modelReady = false;
let startView = null;
let runtimeFailed = false;
let animationFrame = null;
const loadTimings = {};

// ============================================================
//  MODEL URL
//  Each customer gets their own link: https://view.brickrat.com/<slug>
//  The slug is looked up in customers.json (repo root) to find which
//  GLB to load. See customers.json to add a new customer.
// ============================================================
async function resolveModelConfig() {
  // Local validation only. Vite serves these two exact files read-only.
  if (development && params.get('devModel') === 'shareefa') {
    const variant = ['mobile', 'desktop'].includes(params.get('devVariant')) ? params.get('devVariant') : quality.name;
    const config = await resolveCustomerModel({ pathname: '/shareefa', quality: variant, development });
    if (params.get('devProfile') === 'legacy') config.rendering.profile = 'legacy';
    return config;
  }
  return resolveCustomerModel({ pathname: window.location.pathname, quality: quality.name, development });
}

// ============================================================
//  Eye-height constant (metres above floor)
//  Must match the value in FirstPersonControls.js
// ============================================================
const EYE_HEIGHT = 1.65;

// ------------------------------------------------------------
//  Scene
// ------------------------------------------------------------
const scene = new THREE.Scene();

// 4 PM slightly-cloudy sky colour
scene.background = new THREE.Color(0xB8CEDD);

// Subtle atmospheric haze - helps depth perception indoors
// (tweak far distance if the model is very large)
scene.fog = new THREE.FogExp2(0xB8CEDD, 0.002);

// ------------------------------------------------------------
//  Lighting - late-afternoon / 4 PM overcast sun
// ------------------------------------------------------------

// Hemisphere: cool sky dome above, warm earth below
// Mimics the diffuse bounce light of an overcast afternoon
const hemiLight = new THREE.HemisphereLight(
  0x9BBCD4,  // sky colour  - muted steel-blue
  0x7D6B50,  // ground colour - warm tan / earth
  0.9
);
scene.add(hemiLight);

// Directional "sun": warm golden light from low in the west
// position() just sets direction for a DirectionalLight
const sunLight = new THREE.DirectionalLight(0xFFBF7F, 1.1);
sunLight.position.set(-120, 70, -90); // low western sun angle
scene.add(sunLight);

// Soft ambient fill to keep shadowed areas readable
const ambientLight = new THREE.AmbientLight(0xD4C5B0, 0.35);
scene.add(ambientLight);

// ------------------------------------------------------------
//  Camera
// ------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  88,                                    // FOV
  window.innerWidth / window.innerHeight,
  0.05,                                  // near - close enough to avoid clipping indoors
  2000                                   // far
);

// ------------------------------------------------------------
//  Renderer
// ------------------------------------------------------------
function createRenderer() {
  try { return new THREE.WebGLRenderer({ antialias: true }); }
  catch (error) {
    document.querySelector('.progress-ring')?.classList.remove('is-indeterminate');
    document.getElementById('progressText').textContent = 'Rendering unavailable';
    document.getElementById('progressDetail').textContent = 'Please try a browser or device with WebGL 2 support.';
    throw error;
  }
}
const renderer = createRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
// Physically-correct lighting mode for better material appearance
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  throw new Error(`Shader compilation failed (Three r${THREE.REVISION}): ${gl.getProgramInfoLog(program)}\n${gl.getShaderInfoLog(vertex)}\n${gl.getShaderInfoLog(fragment)}`);
};
document.body.appendChild(renderer.domElement);

// ------------------------------------------------------------
//  First-person controller
// ------------------------------------------------------------
const fpController = new FirstPersonController(camera, renderer.domElement, { isMobile });

// ------------------------------------------------------------
//  Loading manager + progress ring
// ------------------------------------------------------------
const loadingOverlay = document.getElementById('loadingOverlay');
const clickPrompt = document.getElementById('clickPrompt');
const btnGhost = document.getElementById('btnGhost');
const btnHome = document.getElementById('btnHome');
const fpsCounter = document.getElementById('fpsCounter');
const progressText = document.getElementById('progressText');
const progressDetail = document.getElementById('progressDetail');
const progressRing = document.querySelector('.progress-ring');
const progressCircle = document.querySelector('.progress-ring__circle');

// A late pointer-unlock event must not cover a loading/rendering error.
document.addEventListener('pointerlockchange', () => {
  if (!modelReady && clickPrompt) clickPrompt.style.display = 'none';
});

const CIRCUMFERENCE = 2 * Math.PI * 50; // r=50 -> ~314

function setProgress(pct) {
  pct = Math.max(0, Math.min(100, pct));
  if (progressRing) progressRing.classList.remove('is-indeterminate');
  if (progressText) progressText.textContent = `${Math.round(pct)}%`;
  if (progressCircle) {
    progressCircle.style.strokeDashoffset =
      CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  }
}

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function setLoadingStatus(message, detail = '') {
  if (progressText) progressText.textContent = message;
  if (progressDetail) progressDetail.textContent = detail;
}

function showReadyScreen() {
  setProgress(100);
  setLoadingStatus('100%', 'Model ready');
  setTimeout(() => {
    if (runtimeFailed) return;
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (clickPrompt) clickPrompt.style.display = 'flex';
    if (btnGhost) btnGhost.style.display = 'flex';
    if (btnHome) btnHome.style.display = 'flex';
    if (fpsCounter) fpsCounter.style.display = 'block';
  }, 400);
}

// Ghost-mode button - 3-second wall pass-through with debounce
let ghostTimer = null;

function activateGhostMode() {
  fpController.wallCollisionEnabled = false;
  if (btnGhost) btnGhost.classList.add('ghost-active');
  if (ghostTimer) clearTimeout(ghostTimer);
  ghostTimer = setTimeout(() => {
    fpController.wallCollisionEnabled = true;
    if (btnGhost) btnGhost.classList.remove('ghost-active');
    ghostTimer = null;
  }, 3000);
}

if (btnGhost) {
  btnGhost.addEventListener('click', activateGhostMode);
}

function returnToStart() {
  if (!modelReady || !startView) return;
  clearTimeout(ghostTimer);
  ghostTimer = null;
  fpController.wallCollisionEnabled = true;
  btnGhost?.classList.remove('ghost-active');
  fpController.resetView(startView);
}

btnHome?.addEventListener('click', event => {
  event.stopPropagation(); // Keep the cursor available when returning from the pause screen.
  returnToStart();
});

// Desktop shortcuts remain available while the cursor is locked for navigation.
window.addEventListener('keydown', e => {
  if (e.code === 'Home' && fpController.isLocked && modelReady) {
    e.preventDefault();
    if (!e.repeat) returnToStart();
  }
  if (e.code === 'Space' && fpController.isLocked) {
    e.preventDefault(); // prevent page scroll
    activateGhostMode();
  }
});

const manager = new THREE.LoadingManager();
manager.onError = url => {
  console.error('Error loading asset:', url);
};

// ------------------------------------------------------------
//  Mobile controls init
// ------------------------------------------------------------
if (isMobile) {
  const mobileControls = new MobileControls(renderer.domElement);
  fpController.setMobileMode(mobileControls);

  // On mobile there is no pointer lock - tapping the prompt activates the controller
  if (clickPrompt) {
    clickPrompt.addEventListener('click', () => {
      clickPrompt.style.display = 'none';
      fpController.isLocked = true;
    });
  }
}

// ------------------------------------------------------------
//  GLTF / GLB loader
// ------------------------------------------------------------
const loader = new GLTFLoader(manager);
// Some customer GLBs are Draco-compressed; decoder files live in lib/three/libs/draco/gltf/
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/lib/three/libs/draco/gltf/');
loader.setDRACOLoader(dracoLoader);
// Some customer GLBs use KTX2 (Basis) textures; transcoder lives in lib/three/libs/basis/
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('/lib/three/libs/basis/');
ktx2Loader.detectSupport(renderer);
loader.setKTX2Loader(ktx2Loader);
const modelLoadStartedAt = performance.now();
let modelDownloadCompletedAt = null;

function logLoadTiming(label, startTime, endTime = performance.now()) {
  loadTimings[label] = endTime - startTime;
  console.info(`[BrickRat load] ${label}: ${Math.round(endTime - startTime)} ms`);
}

function showLinkError() {
  if (progressRing) progressRing.classList.remove('is-indeterminate');
  setLoadingStatus('Link not found', 'This walkthrough link is invalid. Please check the URL you were given.');
}

resolveModelConfig()
  .then(startModelLoad)
  .catch(error => {
    console.error('Failed to resolve model for this link:', error);
    showLinkError();
  });

function showModelError(error) {
  console.error('Failed to prepare/render model:', error);
  runtimeFailed = true;
  modelReady = false;
  fpController.isLocked = false;
  document.exitPointerLock?.();
  if (clickPrompt) clickPrompt.style.display = 'none';
  if (btnGhost) btnGhost.style.display = 'none';
  if (btnHome) btnHome.style.display = 'none';
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (progressRing) progressRing.classList.remove('is-indeterminate');
  const unsupported = /unsupported|HDR framebuffer/.test(error.message);
  setLoadingStatus(unsupported ? 'Rendering unavailable' : 'Model failed to load', unsupported
    ? 'This walkthrough needs HDR support. Please try another browser or device.'
    : 'Please check your connection and refresh the page');
  renderPipeline?.dispose(); renderPipeline = null;
  if (modelRoot) { scene.remove(modelRoot); disposeModel(modelRoot); modelRoot = null; }
  dracoLoader.dispose(); ktx2Loader.dispose();
}

function startModelLoad(modelConfig) {
loader.load(
  modelConfig.url,
  async gltf => {
    modelRoot = gltf.scene;
    try {
    const modelParsedAt = performance.now();
    if (modelDownloadCompletedAt !== null) {
      logLoadTiming('network download', modelLoadStartedAt, modelDownloadCompletedAt);
      logLoadTiming('GLB parse/decode before callback (GPU upload is later)', modelDownloadCompletedAt, modelParsedAt);
    } else {
      logLoadTiming('download plus parse before callback', modelLoadStartedAt, modelParsedAt);
    }

    const sceneSetupStartedAt = performance.now();
    scene.add(gltf.scene);
    // Explicit starts skip the bounding-box scan that used to update transforms.
    // Collision spheres still need current world matrices before setScene().
    gltf.scene.updateMatrixWorld(true);

    setLoadingStatus('Preparing model...', 'Preparing materials');
    const contract = readBakedContract(gltf.scene, modelConfig.rendering);
    if (contract) {
      const { BakedRenderer } = await import('./js/rendering/BakedRenderer.js');
      renderPipeline = new BakedRenderer(renderer, scene, gltf.scene, contract, quality);
      console.info('[BrickRat rendering]', renderPipeline.diagnostics);
    }
    logLoadTiming('material and HDR setup', sceneSetupStartedAt);

    // --- Developer-configured start (automatic search only for older records) ---
    const spawnStartedAt = performance.now();
    startView = getStartView(gltf.scene, modelConfig.startPosition, EYE_HEIGHT);
    logLoadTiming(modelConfig.startPosition ? 'configured starting position' : 'start-position scan', spawnStartedAt);
    fpController.resetView(startView);

    // Register scene meshes for floor raycasting
    setLoadingStatus('Preparing model...', 'Building walkthrough collision data');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const collisionStartedAt = performance.now();
    fpController.setScene(gltf.scene);
    logLoadTiming('collision BVH setup', collisionStartedAt);
    setLoadingStatus('Preparing model...', 'Preparing first frame');
    const gpuStartedAt = performance.now();
    try {
      renderer.setRenderTarget(renderPipeline?.target || null);
      await renderer.compileAsync(scene, camera);
    } finally { renderer.setRenderTarget(null); }
    renderFrame(); // includes transmission, HDR, bloom and the display shader
    logLoadTiming('shader compile and first frame submission', gpuStartedAt);
    modelReady = true;
    dracoLoader.dispose(); ktx2Loader.dispose();
    logLoadTiming('total time to ready', modelLoadStartedAt);
    showReadyScreen();
    } catch (error) { showModelError(error); }
  },
  event => {
    if (event.lengthComputable && event.total > 0) {
      const pct = (event.loaded / event.total) * 100;
      setProgress(pct);
      if (pct >= 100) {
        if (modelDownloadCompletedAt === null) {
          modelDownloadCompletedAt = performance.now();
        }
        setLoadingStatus('Preparing model...', 'Download complete');
      } else {
        setLoadingStatus(
          `${Math.round(pct)}%`,
          `Downloading model: ${formatMegabytes(event.loaded)} / ${formatMegabytes(event.total)}`
        );
      }
    } else {
      if (progressRing) progressRing.classList.add('is-indeterminate');
      setLoadingStatus('Downloading model...', `${formatMegabytes(event.loaded)} downloaded`);
    }
  },
  showModelError
);
}

// ------------------------------------------------------------
//  Window resize
// ------------------------------------------------------------
function resizeViewport() {
  // visualViewport reflects the final usable dimensions more reliably after
  // mobile orientation changes than the first window resize event.
  const width = Math.round(window.visualViewport?.width || window.innerWidth);
  const height = Math.round(window.visualViewport?.height || window.innerHeight);
  if (!width || !height) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(width, height);
  try { renderPipeline?.resize(); } catch (error) { showModelError(error); }
}

function scheduleViewportResize() {
  requestAnimationFrame(() => requestAnimationFrame(resizeViewport));
  setTimeout(resizeViewport, 250);
}

window.addEventListener('resize', scheduleViewportResize);
window.addEventListener('orientationchange', scheduleViewportResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleViewportResize);
}

// ------------------------------------------------------------
//  Animation loop
// ------------------------------------------------------------
const clock = new THREE.Clock();
let fpsFrames = 0;
let fpsElapsed = 0;

function animate() {
  animationFrame = requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // cap at 100 ms to avoid teleporting on tab-switch

  // FPS counter - update once per second
  fpsFrames++;
  fpsElapsed += dt;
  if (fpsElapsed >= 1.0) {
    fpsCounter.textContent = Math.round(fpsFrames / fpsElapsed) + ' FPS';
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  if (modelReady && !runtimeFailed) {
    try {
      fpController.update(dt);
      renderFrame();
    } catch (error) { showModelError(error); }
  }
}

function renderFrame() {
  if (renderPipeline) renderPipeline.render(camera);
  else renderer.render(scene, camera);
}

if (development) {
  import('./js/rendering/devTools.js').then(({ installDevTools }) => installDevTools({
    THREE, renderer, scene, camera, controller: fpController, renderFrame,
    status: () => ({ ready: modelReady, failed: runtimeFailed, quality,
      diagnostics: renderPipeline?.diagnostics || { profile: 'legacy' }, loadTimings }),
  }));
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return; // a bfcache page will resume using its GPU resources
  cancelAnimationFrame(animationFrame);
  if (ghostTimer) clearTimeout(ghostTimer);
  renderPipeline?.dispose();
  if (modelRoot) disposeModel(modelRoot);
  dracoLoader.dispose(); ktx2Loader.dispose(); renderer.dispose();
});

animate();
