#!/usr/bin/env node
/**
 * Copies mermaid's prebuilt UMD bundle into public/vendor/.
 *
 * Mermaid's ESM graph is ~44 MB of chunks and pushes an older build container
 * out of memory. The diagram library is only needed once a slide actually has
 * a ```mermaid fence, so the app loads this prebuilt file lazily at runtime
 * from its own origin (no CDN, works offline after the first render).
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/mermaid/dist/mermaid.min.js');
const targetDir = resolve(root, 'public/vendor');
const target = resolve(targetDir, 'mermaid.min.js');

if (!existsSync(source)) {
  console.error('[vendor] mermaid.min.js 를 찾지 못했습니다. `npm install` 후 다시 시도하세요.');
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
const size = (statSync(target).size / 1024 / 1024).toFixed(2);
console.log(`[vendor] public/vendor/mermaid.min.js (${size} MB)`);
