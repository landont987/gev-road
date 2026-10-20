// Speed and red-light cameras: overpass-api.de now only speaks TLS 1.3, which
// Android 9's WebView cannot, so on the truck the list must come through the
// Android app (GevNative.http), not the page's own fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// esbuild bundles the JSON import; node needs to be told it is JSON.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) return nextLoad(url, Object.assign({}, context, { importAttributes: { type: 'json' } }));
    return nextLoad(url, context);
  },
});

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
};

const nativeCalls = [];
const ANSWER = JSON.stringify({
  elements: [{ type: 'node', id: 1, lat: 33.5, lon: -112.1, tags: { highway: 'speed_camera', maxspeed: '45 mph' } }],
});
globalThis.window = {
  GevNative: {
    http(id, method, url) {
      nativeCalls.push({ method, url });
      setImmediate(() => window.gevOnHttp(id, 200, ANSWER, -1));
    },
  },
};
let pageFetches = 0;
globalThis.fetch = () => {
  pageFetches++;
  return Promise.reject(new Error('TLS 1.3 only: the old WebView cannot connect'));
};

const { createSpeedCameras } = await import('../web/src/speed-cameras.js');

test('the speed camera list is fetched through the Android app (overpass-api.de is TLS 1.3 only)', async () => {
  const cams = createSpeedCameras();
  cams.spots();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pageFetches, 0, 'the page itself must not try overpass-api.de');
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].method, 'GET');
  assert.ok(nativeCalls[0].url.indexOf('https://overpass-api.de/api/interpreter?data=') === 0);
  const spots = cams.spots();
  assert.equal(spots.length, 1, 'the fresh list replaced the bundled one');
});
