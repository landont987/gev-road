// LIVE CALLS: recorded police and fire radio calls played inside the app,
// through the Broadcastify Calls Client API (bcfy.io/dev). Their program allows
// scanner-style listening apps scoped to one metro, metered per record read.
//
// How it works (copied from working open source clients, see config.js):
//  1. Sign an HS256 token with the app's key (kid = key id, iss = app id).
//  2. POST your Broadcastify username and password to /common/v1/auth with
//     that token -> { uid, token, exp }.
//  3. Sign a second token that also carries sub = uid and utk = token.
//  4. GET /calls/v1/live/?groups=a,b,c&init=1, then &pos=<lastPos> every few
//     seconds -> { calls: [{ groupId, ts, descr, duration, url }], lastPos }.
//  5. Queue the new calls and play them one after another in one <audio>.
// The API answers browser preflights with 401, so on the truck the requests
// go through the Android app (native-fetch.js); the audio files play in a
// plain <audio>, which needs no CORS.
//
// Pure helpers (token, queue order) are exported for tests; nothing here
// touches the DOM except through the callbacks the radio sheet passes in.

import { KEYS, BCFY_AUTH_URL, BCFY_LIVE_URL, BCFY_POLL_MS, BCFY_TOKEN_TTL_S } from './config.js';
import { nativeFetch } from './native-fetch.js';

const MAX_QUEUE = 12; // older calls are dropped so the player never falls far behind live

export function hasCallsKeys() {
  return !!(KEYS.bcfyKeyId && KEYS.bcfySecret && KEYS.bcfyAppId);
}

function base64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (text) => new TextEncoder().encode(text);

/** HS256 token the way the Calls API expects it. `now` is seconds. */
export async function signToken(keys, claims, now, cryptoImpl) {
  const subtle = (cryptoImpl || window.crypto).subtle;
  const header = { alg: 'HS256', typ: 'JWT', kid: keys.bcfyKeyId };
  const payload = Object.assign({ iss: keys.bcfyAppId, iat: now, exp: now + BCFY_TOKEN_TTL_S }, claims);
  const input = `${base64Url(utf8(JSON.stringify(header)))}.${base64Url(utf8(JSON.stringify(payload)))}`;
  const key = await subtle.importKey('raw', utf8(keys.bcfySecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('HMAC', key, utf8(input));
  return `${input}.${base64Url(new Uint8Array(sig))}`;
}

/** New calls from one live answer, oldest first, skipping ones already seen. Pure. */
export function newCalls(answer, seen) {
  const calls = (answer && Array.isArray(answer.calls) ? answer.calls : [])
    .filter((c) => c && typeof c.url === 'string' && /^https:\/\//.test(c.url) && Number.isFinite(Number(c.ts)))
    .map((c) => ({
      key: `${c.groupId}-${c.ts}`,
      groupId: String(c.groupId || ''),
      ts: Number(c.ts),
      descr: typeof c.descr === 'string' ? c.descr : '',
      duration: Number.isFinite(Number(c.duration)) ? Number(c.duration) : 0,
      url: c.url,
    }))
    .filter((c) => !seen[c.key])
    .sort((a, b) => a.ts - b.ts);
  return calls;
}

/**
 * callbacks: { onStatus(text), onCall(call), onError(message) }
 * login: { username, password } typed by the driver (stored only on the unit).
 */
export function createCallsPlayer(callbacks) {
  let session = null; // { uid, token, exp }
  let groups = [];
  let pos = 0;
  let seen = {};
  let queue = [];
  let audio = null;
  let timer = null;
  let running = false;
  let login = null;

  async function authenticate() {
    const now = Math.floor(Date.now() / 1000);
    if (session && session.exp > now + 60) return;
    const appToken = await signToken(KEYS, {}, now);
    const body = `username=${encodeURIComponent(login.username)}&password=${encodeURIComponent(login.password)}`;
    const res = await nativeFetch(BCFY_AUTH_URL, 20000, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.status === 401) throw new Error('Broadcastify did not accept the key or the login.');
    if (!res.ok) throw new Error(`Broadcastify login answered HTTP ${res.status}.`);
    const data = await res.json();
    if (!data || !data.uid || !data.token) throw new Error('Broadcastify login answer had no session.');
    session = { uid: data.uid, token: data.token, exp: Number(data.exp) || now + BCFY_TOKEN_TTL_S - 100 };
  }

  async function poll() {
    await authenticate();
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(KEYS, { sub: Number(session.uid), utk: session.token }, now);
    const query = pos ? `pos=${pos}` : 'init=1';
    const res = await nativeFetch(`${BCFY_LIVE_URL}?groups=${encodeURIComponent(groups.join(','))}&${query}`, 20000, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 402) throw new Error('Broadcastify prepaid balance is empty. Top up at bcfy.io/dev.');
    if (res.status === 401) {
      session = null;
      throw new Error('Broadcastify session expired; signing in again.');
    }
    if (res.status === 429) return; // rate limited: skip this round
    if (!res.ok) throw new Error(`Calls API answered HTTP ${res.status}.`);
    const answer = await res.json();
    if (Number.isFinite(Number(answer.lastPos))) pos = Number(answer.lastPos);
    const fresh = newCalls(answer, seen);
    for (const call of fresh) seen[call.key] = true;
    queue = queue.concat(fresh).slice(-MAX_QUEUE);
    callbacks.onStatus(queue.length ? `${queue.length} waiting` : 'listening');
    playNext();
  }

  // One call at a time: a finished or failed call is "paused", so the next one starts.
  function playNext() {
    if (!running || !audio || !audio.paused) return;
    const call = queue.shift();
    if (!call) return;
    callbacks.onCall(call);
    audio.src = call.url;
    audio.play().catch((err) => {
      console.warn('calls play:', err);
      playNext();
    });
  }

  function tick() {
    poll().catch((err) => {
      console.warn('calls:', err);
      callbacks.onError(err.message || 'The Calls API did not answer.');
    });
  }

  return {
    start(groupIds, credentials) {
      this.stop();
      groups = groupIds.slice();
      login = credentials;
      running = true;
      pos = 0;
      seen = {};
      queue = [];
      audio = new Audio();
      audio.preload = 'auto';
      audio.onended = playNext;
      audio.onerror = () => {
        console.warn('calls: audio failed', audio.src);
        playNext();
      };
      callbacks.onStatus('signing in');
      tick();
      timer = setInterval(tick, BCFY_POLL_MS);
    },
    stop() {
      running = false;
      clearInterval(timer);
      timer = null;
      queue = [];
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio = null;
      }
    },
    isRunning: () => running,
  };
}
