import * as THREE from './lib/three/three.module.js';
import { GLTFLoader } from './lib/three/loaders/GLTFLoader.js';
import { FirstPersonController } from './js/controls/FirstPersonControls.js';
import { MobileControls } from './js/controls/MobileControls.js';
import { findStartPosition } from './js/utils/findStartPosition.js';

// ============================================================
//  Device detection
// ============================================================
const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ============================================================
//  MODEL URL
//  Local dev  -> put your GLB inside the "assets/" folder and
//               keep the path below as-is.
//  Production -> replace with the direct URL of your hosted GLB
//               (GitHub Release asset, Cloudflare R2, etc.)
// ============================================================
// const MODEL_URL = 'https://pub-4622c204bf054ed7ae6895e757c1af7f.r2.dev/model.glb';
const MODEL_URL = 'https://pub-4622c204bf054ed7ae6895e757c1af7f.r2.dev/baked.glb';

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
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Physically-correct lighting mode for better material appearance
renderer.useLegacyLights = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
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
const fpsCounter = document.getElementById('fpsCounter');
const progressText = document.getElementById('progressText');
const progressDetail = document.getElementById('progressDetail');
const progressRing = document.querySelector('.progress-ring');
const progressCircle = document.querySelector('.progress-ring__circle');

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
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (clickPrompt) clickPrompt.style.display = 'flex';
    if (btnGhost) btnGhost.style.display = 'flex';
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

// Space Bar triggers ghost mode while pointer is locked (desktop shortcut)
window.addEventListener('keydown', e => {
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

loader.load(
  MODEL_URL,
  gltf => {
    scene.add(gltf.scene);

    // --- Smart start position ---
    const startPos = findStartPosition(gltf.scene, EYE_HEIGHT);
    camera.position.copy(startPos);

    // Tell the controller where the floor is from the very first frame
    fpController.setGroundY(startPos.y - EYE_HEIGHT);

    // --- Initial look direction ---
    // Face toward the centre of the model's bounding box (horizontal only)
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const centre = box.getCenter(new THREE.Vector3());
    const toCenter = new THREE.Vector3(
      centre.x - startPos.x,
      0,
      centre.z - startPos.z
    );
    if (toCenter.lengthSq() > 0.001) {
      // yaw = angle in XZ plane to face the model interior
      fpController.setYaw(Math.atan2(toCenter.x, toCenter.z));
    }

    // Register scene meshes for floor raycasting
    setLoadingStatus('Preparing model...', 'Building walkthrough collision data');
    fpController.setScene(gltf.scene);
    showReadyScreen();
  },
  event => {
    if (event.lengthComputable && event.total > 0) {
      const pct = (event.loaded / event.total) * 100;
      setProgress(pct);
      if (pct >= 100) {
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
  err => {
    console.error('Failed to load model:', err);
    if (progressRing) progressRing.classList.remove('is-indeterminate');
    setLoadingStatus('Model failed to load', 'Please check your connection and refresh the page');
  }
);

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
  renderer.setSize(width, height);
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
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // cap at 100 ms to avoid teleporting on tab-switch

  // FPS counter - update once per second
  fpsFrames++;
  fpsElapsed += dt;
  if (fpsElapsed >= 1.0) {
    fpsCounter.textContent = Math.round(fpsFrames / fpsElapsed) + ' FPS';
    fpsFrames = 0;
    fpsElapsed = 0;
  }

  fpController.update(dt);

  renderer.render(scene, camera);
}

animate();
