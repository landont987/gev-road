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

// az511.com sends no CORS header and api.bcfy.io answers browser preflights with
// 401, so the preview page reaches them through these relays at /az511/ and
// /bcfy/ (on the truck, the Android app makes the request instead). Preview only.
const RELAYS = [
  { prefix: '/az511/', origin: 'https://az511.com/', pass: [] },
  { prefix: '/bcfy/', origin: 'https://api.bcfy.io/', pass: ['authorization', 'content-type', 'content-length'] },
];
http
  .createServer((req, res) => {
    const relay = RELAYS.find((r) => req.url.startsWith(r.prefix));
    const target = relay ? `${relay.origin}${req.url.slice(relay.prefix.length)}` : `http://127.0.0.1:${inner.port}${req.url}`;
    const send = relay ? https : http;
    const headers = relay ? { 'user-agent': 'GEVRoad-preview' } : req.headers;
    if (relay) for (const name of relay.pass) if (req.headers[name]) headers[name] = req.headers[name];
    const out = send.request(target, { method: req.method, headers }, (answer) => {
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
