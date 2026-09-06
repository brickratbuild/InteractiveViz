import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('sw.js');
const target = resolve('dist/sw.js');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
