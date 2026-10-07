// fetch() for APIs the WebView cannot reach on its own.
// api.bcfy.io sends "access-control-allow-origin: *" on real answers but
// returns 401 to the browser's preflight, so a scripted request with an
// Authorization header never leaves the page. On the truck the Android app
// makes the request itself (GevNative.http) and posts the answer back into
// window.gevOnHttp. On a computer this falls back to the normal fetch, which
// is how the preflight problem shows up in the console.

import { fetchWithTimeout } from './ui.js';

const pending = {};
let nextId = 1;

/** Called by the Android app: status 0 means the request never got through. */
function onNativeAnswer(id, status, body) {
  const entry = pending[id];
  if (!entry) return;
  delete pending[id];
  clearTimeout(entry.timer);
  entry.resolve(makeResponse(status, body));
}
if (typeof window !== 'undefined') window.gevOnHttp = onNativeAnswer; // tests import this under node

/** The small part of a Response the app uses. Pure, for tests. */
export function makeResponse(status, body) {
  const text = typeof body === 'string' ? body : '';
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  };
}

export function hasNativeHttp() {
  return !!(window.GevNative && typeof window.GevNative.http === 'function');
}

/** init: { method, headers: { Authorization, 'Content-Type' }, body } */
export function nativeFetch(url, timeoutMs, init) {
  const options = init || {};
  if (!hasNativeHttp()) return fetchWithTimeout(url, timeoutMs, options);
  const headers = options.headers || {};
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending[id] = {
      resolve: (res) => {
        if (res.status === 0) reject(new Error('no answer from the network'));
        else resolve(res);
      },
      timer: setTimeout(() => {
        delete pending[id];
        reject(new Error('timed out'));
      }, timeoutMs),
    };
    try {
      window.GevNative.http(
        id,
        options.method || 'GET',
        url,
        headers.Authorization || '',
        headers['Content-Type'] || '',
        typeof options.body === 'string' ? options.body : '',
      );
    } catch (err) {
      clearTimeout(pending[id].timer);
      delete pending[id];
      reject(err);
    }
  });
}
