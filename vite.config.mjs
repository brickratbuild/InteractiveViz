import { defineConfig } from 'vite';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Dev-only exact allowlist. No package files are copied into builds or modified.
const reference = new URL('../shareefa_walkthrough_2026-11-11/v13/', import.meta.url);
const files = {
  '/__reference/desktop.glb': 'latest/exports/interior_hyb_log12_g21.glb',
  '/__reference/mobile.glb': 'latest/exports/interior_mobile_m3.glb',
};
export default defineConfig({
  plugins: [{ name: 'local-baked-reference', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const file = files[new URL(req.url, 'http://localhost').pathname];
      if (!file) return next();
      try {
        const path = fileURLToPath(new URL(file, reference)), info = await stat(path);
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
        createReadStream(path).on('error', () => res.destroy()).pipe(res);
      } catch { res.writeHead(404).end('Local reference package is unavailable'); }
    });
  } }],
});
