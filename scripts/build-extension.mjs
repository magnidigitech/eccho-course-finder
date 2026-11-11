import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'dist-extension');
const extSrc = path.join(root, 'extension');

fs.rmSync(outDir, { recursive: true, force: true });

const tscRes = spawnSync('npx', ['tsc', '-b'], {
  cwd: root,
  stdio: 'inherit',
});
if (tscRes.status !== 0) {
  process.exit(tscRes.status ?? 1);
}

const viteRes = spawnSync(
  'npx',
  ['vite', 'build', '--base=./', '--outDir', 'dist-extension'],
  { cwd: root, stdio: 'inherit' },
);
if (viteRes.status !== 0) {
  process.exit(viteRes.status ?? 1);
}

// Copy MV3 manifest, background worker, and verified PNG icons
fs.copyFileSync(
  path.join(extSrc, 'manifest.json'),
  path.join(outDir, 'manifest.json'),
);
fs.copyFileSync(
  path.join(extSrc, 'background.js'),
  path.join(outDir, 'background.js'),
);

const iconsOut = path.join(outDir, 'icons');
fs.mkdirSync(iconsOut, { recursive: true });
for (const size of ['16', '48', '128']) {
  const iconFile = `icon-${size}.png`;
  const srcIcon = path.join(extSrc, 'icons', iconFile);
  if (!fs.existsSync(srcIcon)) {
    throw new Error(`Missing required extension icon: ${srcIcon}`);
  }
  fs.copyFileSync(srcIcon, path.join(iconsOut, iconFile));
}

// Verify zero external CDN script tags in extension HTML
const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
if (/https?:\/\//i.test(indexHtml)) {
  throw new Error('Extension index.html must not reference remote HTTP/HTTPS URLs.');
}

console.log('Extension build ready at dist-extension/');

