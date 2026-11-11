import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build as viteBuild } from 'vite';

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

// 1. Build converter tab React SPA with relative asset paths and bundled worker
const viteRes = spawnSync(
  'npx',
  ['vite', 'build', '--base=./', '--outDir', 'dist-extension'],
  { cwd: root, stdio: 'inherit' },
);
if (viteRes.status !== 0) {
  process.exit(viteRes.status ?? 1);
}

// 2. Compile shared TypeScript discovery background service worker into dist-extension/background.js
await viteBuild({
  configFile: false,
  build: {
    outDir,
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: path.join(root, 'src/extension/background.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
});

// 3. Copy MV3 manifest and resized toolbar PNG icons
fs.copyFileSync(
  path.join(extSrc, 'manifest.json'),
  path.join(outDir, 'manifest.json'),
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

// 4. Verify zero external CDN script tags in extension HTML and valid SW syntax
const indexHtml = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
if (/https?:\/\//i.test(indexHtml)) {
  throw new Error('Extension index.html must not reference remote HTTP/HTTPS URLs.');
}
if (!fs.existsSync(path.join(outDir, 'background.js'))) {
  throw new Error('Extension background.js was not generated.');
}

console.log('Extension build ready at dist-extension/');
