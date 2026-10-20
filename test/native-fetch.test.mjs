// nativeFetch hands requests to the Android app. The app's plain http() bridge
// always gave up after 20 s whatever the page asked for, so a slow answer
// (Overpass took 33 s on 2026-10-20; AZ511's 2.4 MB closures list on a weak
// hotspot) failed early. The caller's timeout must reach the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const sent = [];
globalThis.window = {
  GevNative: {
    http() {
      sent.push({ bridge: 'http', timeoutMs: 20000 }); // http() has no timeout: the app uses 20 s
    },
    httpEx(id, method, url, headersJson, body, base64, timeoutMs) {
      sent.push({ bridge: 'httpEx', method, url, headers: JSON.parse(headersJson), body, base64, timeoutMs });
      setImmediate(() => window.gevOnHttp(id, 200, '{"ok":true}', -1));
    },
  },
};

const { nativeFetch } = await import('../web/src/native-fetch.js');

test("the page's timeout reaches the app", async () => {
  const res = await nativeFetch('https://overpass-api.de/api/interpreter?data=x', 60000);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].timeoutMs, 60000);
});

test('method, Authorization, Content-Type and body are passed on, and the answer is text', async () => {
  sent.length = 0;
  const res = await nativeFetch('https://api.bcfy.io/common/v1/auth', 20000, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=a&password=b',
  });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent[0].bridge, 'httpEx');
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(sent[0].headers, { Authorization: 'Bearer t', 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(sent[0].body, 'username=a&password=b');
  assert.equal(sent[0].base64, false);
});
