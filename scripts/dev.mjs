// Local preview of the app at http://localhost:4180 (rebuilds on change).

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
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
const inner = await ctx.serve({ servedir: path.dirname(buildOptions.outfile), port: PORT + 1, host: '127.0.0.1' });

// az511.com sends no CORS header, so the preview page reaches it through this
// relay at /az511/ (on the truck, the Android app makes the request instead).
http
  .createServer((req, res) => {
    const relay = req.url.startsWith('/az511/');
    const target = relay ? `https://az511.com/${req.url.slice('/az511/'.length)}` : `http://127.0.0.1:${inner.port}${req.url}`;
    const send = relay ? https : http;
    const out = send.request(target, { method: req.method, headers: relay ? { 'user-agent': 'GEVRoad-preview' } : req.headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    out.on('error', (err) => {
      res.writeHead(502);
      res.end(String(err.message));
    });
    req.pipe(out);
  })
  .listen(PORT, '127.0.0.1');
console.log(`GEV Road preview: http://localhost:${PORT}`);
