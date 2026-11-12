// Installed on loopback hosts only; no customer-facing settings or camera UI.
export function installDevTools({ THREE, renderer, scene, camera, controller, renderFrame, status }) {
  window.brickratDev = { renderer, scene, camera, controller, status, renderFrame,
    getStartPosition() {
      const rounded = value => Number(value.toFixed(6));
      return { x: rounded(camera.position.x), y: rounded(controller.lastGroundY), z: rounded(camera.position.z),
        yaw: rounded(THREE.MathUtils.radToDeg(controller.yaw)), pitch: rounded(THREE.MathUtils.radToDeg(controller.pitch)) };
    },
    placeCamera({ x, y, z, yaw = 0, pitch = 0, fov = 70 }) {
      controller.isLocked = false;
      camera.position.set(x, y, z); // eye coordinates, matching recorded reference captures
      controller.setGroundY(y - 1.65);
      controller.yaw = THREE.MathUtils.degToRad(yaw);
      controller.pitch = THREE.MathUtils.degToRad(pitch);
      controller.update(0);
      camera.fov = fov; camera.updateProjectionMatrix();
      renderFrame();
    },
    benchmark(frames = 30) {
      if (!status().ready) throw new Error('Model is not ready');
      frames = Math.max(1, Math.min(300, frames));
      const gl = renderer.getContext(), pixel = new Uint8Array(4);
      const draw = () => { renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
      for (let i = 0; i < 5; i++) draw();
      const times = [];
      for (let i = 0; i < frames; i++) { const start = performance.now(); draw(); times.push(performance.now() - start); }
      times.sort((a, b) => a - b);
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { frames, meanMs: times.reduce((a, b) => a + b, 0) / frames,
        medianMs: times[Math.floor(frames / 2)], p95Ms: times[Math.min(frames - 1, Math.floor(frames * 0.95))],
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        method: 'Back-to-back render + synchronous 1-pixel GPU read; excludes navigation and loading' };
    },
  };
}
