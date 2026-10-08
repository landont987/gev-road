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

/** Called by the Android app: status 0 means the request never got through; ageSeconds is -1 when unknown. */
function onNativeAnswer(id, status, body, ageSeconds) {
  const entry = pending[id];
  if (!entry) return;
  delete pending[id];
  clearTimeout(entry.timer);
  entry.resolve(makeResponse(status, body, ageSeconds), body);
}

/** Why a status-0 answer never reached the server, in plain words. */
function failureText(body) {
  const text = typeof body === 'string' ? body : '';
  if (text.indexOf('refused:') === 0) return `the app blocked this request (${text.slice(8).trim()})`;
  if (text.indexOf('app error') === 0) return text;
  return 'no answer from the network';
}
if (typeof window !== 'undefined') window.gevOnHttp = onNativeAnswer; // tests import this under node

/** The small part of a Response the app uses. Pure, for tests. */
export function makeResponse(status, body, ageSeconds) {
  const text = typeof body === 'string' ? body : '';
  return {
    ok: status >= 200 && status < 300,
    status,
    ageSeconds: Number.isFinite(ageSeconds) && ageSeconds >= 0 ? ageSeconds : null,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text)),
  };
}

export function hasNativeHttp() {
  return !!(window.GevNative && typeof window.GevNative.http === 'function');
}

/** Waits for window.gevOnHttp(id, ...) after start(id) hands the request to the app. */
function viaApp(timeoutMs, start) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending[id] = {
      resolve: (res, body) => {
        if (res.status === 0) reject(new Error(failureText(body)));
        else resolve(res);
      },
      timer: setTimeout(() => {
        delete pending[id];
        reject(new Error('timed out'));
      }, timeoutMs),
    };
    try {
      start(id);
    } catch (err) {
      clearTimeout(pending[id].timer);
      delete pending[id];
      reject(err);
    }
  });
}

/** init: { method, headers: { Authorization, 'Content-Type' }, body } */
export function nativeFetch(url, timeoutMs, init) {
  const options = init || {};
  if (!hasNativeHttp()) return fetchWithTimeout(url, timeoutMs, options);
  const headers = options.headers || {};
  return viaApp(timeoutMs, (id) =>
    window.GevNative.http(
      id,
      options.method || 'GET',
      url,
      headers.Authorization || '',
      headers['Content-Type'] || '',
      typeof options.body === 'string' ? options.body : '',
    ),
  );
}

export function hasNativeRequest() {
  return !!(window.GevNative && typeof window.GevNative.httpEx === 'function');
}

/**
 * Like nativeFetch, with any headers, and with base64: true the body comes back
 * as base64 text (pictures); the caller decodes it. Android app only: the hosts
 * it serves (OpenAI, Gemini, az511.com) cannot be reached from the page.
 * init: { method, headers: { name: value }, body, base64 }
 */
export function nativeRequest(url, timeoutMs, init) {
  const options = init || {};
  if (!hasNativeRequest()) return Promise.reject(new Error('this needs the Android app'));
  return viaApp(timeoutMs, (id) =>
    window.GevNative.httpEx(
      id,
      options.method || 'GET',
      url,
      JSON.stringify(options.headers || {}),
      typeof options.body === 'string' ? options.body : '',
      !!options.base64,
      timeoutMs,
    ),
  );
}
