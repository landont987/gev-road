// Local preview of the app at http://localhost:4180 (rebuilds on change).

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOptions, copyStatic } from './build-web.mjs';

const PORT = 4180;
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

copyStatic();
for (const file of ['index.html', 'style.css']) {
  fs.watch(path.join(webDir, file), () => copyStatic());
}
const ctx = await esbuild.context({ ...buildOptions, minify: false, sourcemap: 'inline' });
await ctx.watch();
await ctx.serve({ servedir: path.dirname(buildOptions.outfile), port: PORT, host: '127.0.0.1' });
console.log(`GEV Road preview: http://localhost:${PORT}`);
