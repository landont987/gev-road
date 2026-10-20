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

// A big answer (the 2.4 MB closures feed) is kept by the app and pulled by the
// page with fetch() (#59), so it never crosses as a script literal.
test('a kept answer is pulled from /native/http/<id> and read as text', async () => {
  sent.length = 0;
  const fetched = [];
  globalThis.fetch = (url) => {
    fetched.push(url);
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[{"big":true}]') });
  };
  window.GevNative.httpEx = (id) => setImmediate(() => window.gevOnHttp(id, 200, null, 7, true));
  const res = await nativeFetch('https://az511.com/api/v2/get/event?format=json&key=k', 45000);
  assert.equal(res.status, 200);
  assert.equal(res.ageSeconds, 7);
  assert.deepEqual(await res.json(), [{ big: true }]);
  assert.equal(fetched.length, 1);
  assert.match(String(fetched[0]), /^\/native\/http\/\d+$/);
});

test('a kept answer the app no longer has fails like a network failure', async () => {
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  window.GevNative.httpEx = (id) => setImmediate(() => window.gevOnHttp(id, 200, null, -1, true));
  await assert.rejects(nativeFetch('https://az511.com/api/v2/get/event?format=json&key=k', 45000), /app error: the answer was lost/);
});
