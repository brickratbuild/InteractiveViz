import { copyFile, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('sw.js');
const target = resolve('dist/sw.js');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

// These URLs are intentionally stable in both root-static hosting and dist.
// Vite does not see decoder paths, fetch('/customers.json') or manifest icons.
for (const file of ['customers.json', 'manifest.json']) await copyFile(resolve(file), resolve('dist', file));
for (const directory of ['images', 'lib/three/libs/draco/gltf', 'lib/three/libs/basis']) {
  await cp(resolve(directory), resolve('dist', directory), { recursive: true });
}
// Manifest icon paths are relative to the manifest, so keep it at the root.
const htmlPath = resolve('dist/index.html');
const html = await readFile(htmlPath, 'utf8');
await writeFile(htmlPath, html
  .replace(/href="[^"]*manifest-[^"]+\.json"/, 'href="/manifest.json"')
  .replace('href="/manifest.json">\r\n', 'href="/manifest.json">\n'));
