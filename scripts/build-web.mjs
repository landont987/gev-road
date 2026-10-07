// Bundles web/src into web/dist (one app.js + static files).
// `--android` also copies the result into the Android app's assets.
// Keys come from keys.local.json (never committed); missing keys just leave
// those features switched off.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
const androidAssets = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'web');

export function readKeys() {
  const file = path.join(root, 'keys.local.json');
  if (!fs.existsSync(file)) return {};
  const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { tomtom: typeof keys.tomtom === 'string' ? keys.tomtom.trim() : '' };
}

export const buildOptions = {
  entryPoints: [path.join(root, 'web', 'src', 'main.js')],
  bundle: true,
  outfile: path.join(dist, 'app.js'),
  format: 'iife',
  // Android 9 head units can ship an old System WebView; Chrome 61 is a safe floor.
  target: ['chrome61'],
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  define: { __KEYS__: JSON.stringify(readKeys()) },
  logLevel: 'warning',
};

export function copyStatic() {
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(path.join(root, 'web', 'index.html'), path.join(dist, 'index.html'));
  fs.copyFileSync(path.join(root, 'web', 'style.css'), path.join(dist, 'style.css'));
  fs.copyFileSync(path.join(root, 'node_modules', 'leaflet', 'dist', 'leaflet.css'), path.join(dist, 'leaflet.css'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyStatic();
  await esbuild.build(buildOptions);
  if (process.argv.includes('--android')) {
    fs.rmSync(androidAssets, { recursive: true, force: true });
    fs.cpSync(dist, androidAssets, { recursive: true });
  }
  const size = (f) => `${(fs.statSync(path.join(dist, f)).size / 1024).toFixed(0)} KB`;
  console.log(`built web/dist: app.js ${size('app.js')}, leaflet.css ${size('leaflet.css')}, style.css ${size('style.css')}`);
}
