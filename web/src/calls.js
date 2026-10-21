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
import { trackPlayer } from './audio-duck.js';

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
 * callbacks: { onStatus(text), onCall(call), onError(message, fatal) }; with
 * fatal the player has stopped (a refused login, an empty balance).
 * login: { username, password } typed by the driver (stored only on the unit).
 */
// The live endpoint takes at most 5 groups per request ("Too many groups
// (limit 5)", HTTP 500) and wants plain commas: with %2C it reads the list as
// one unknown group and answers 200 with no calls (both checked 10/20).
export const MAX_GROUPS_PER_REQUEST = 5;

/** groups -> [{ groups, pos }] chunks of at most 5, each polled on its own. */
export function groupChunks(groupIds) {
  const chunks = [];
  for (let i = 0; i < groupIds.length; i += MAX_GROUPS_PER_REQUEST) {
    chunks.push({ groups: groupIds.slice(i, i + MAX_GROUPS_PER_REQUEST), pos: 0 });
  }
  return chunks;
}

const START_WINDOW_S = 600;
const START_MAX_CALLS = 3;
/** With no call this long, the status says how long the channel has been quiet. */
export const QUIET_AFTER_S = 60;

/**
 * The first answer (init=1) brings the last ~25 calls, some many minutes old.
 * Start with the newest few from the last 10 minutes: something to hear within
 * seconds of the tap, without replaying a backlog (#67).
 */
export function recentOnly(calls, serverTime) {
  const now = Number(serverTime);
  if (!Number.isFinite(now) || now <= 0) return calls;
  return calls.filter((c) => c.ts >= now - START_WINDOW_S).slice(-START_MAX_CALLS);
}

/** The status with nothing queued: "listening", or how long the channel has been quiet. Pure. */
export function idleStatus(lastCallTs, nowS) {
  if (!(lastCallTs > 0)) return 'listening, no call yet';
  const quietS = nowS - lastCallTs;
  if (quietS < QUIET_AFTER_S) return 'listening';
  return `quiet for ${Math.max(1, Math.round(quietS / 60))} min`;
}

/** The query for one chunk: plain commas between ids, each id encoded on its own. */
export function liveQuery(chunk) {
  const groups = chunk.groups.map(encodeURIComponent).join(',');
  return `groups=${groups}&${chunk.pos ? `pos=${chunk.pos}` : 'init=1'}`;
}

// A call's audio that neither ends nor fails this long after its own length
// (a hotspot stall mid-file) is skipped, so the calls behind it still play.
const STALL_MARGIN_MS = 15000;

/** An error retrying cannot fix: the player stops instead of asking again every few seconds. */
function fatal(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

export function createCallsPlayer(callbacks) {
  let session = null; // { uid, token, exp }
  let chunks = []; // [{ groups, pos }], at most 5 groups each
  let seen = {};
  let queue = [];
  let audio = null;
  let timer = null;
  let stallTimer = null;
  let running = false;
  let login = null;
  let polling = false; // a poll is out: the next one waits (every live request is billed)
  let generation = 0; // bumped by start and stop: answers for an older run are dropped
  let lastError = ''; // a passing error is reported once, until a poll works again
  let lastCallTs = 0; // the newest call seen, for "quiet for N min"

  async function authenticate(mine) {
    const now = Math.floor(Date.now() / 1000);
    if (session && session.exp > now + 60) return;
    const appToken = await signToken(KEYS, {}, now);
    const body = `username=${encodeURIComponent(login.username)}&password=${encodeURIComponent(login.password)}`;
    const res = await nativeFetch(BCFY_AUTH_URL, 20000, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.status === 401) throw fatal('Broadcastify did not accept the key or the login.');
    if (!res.ok) throw new Error(`Broadcastify login answered HTTP ${res.status}.`);
    const data = await res.json();
    if (!data || !data.uid || !data.token) throw new Error('Broadcastify login answer had no session.');
    if (mine !== generation) return;
    session = { uid: data.uid, token: data.token, exp: Number(data.exp) || now + BCFY_TOKEN_TTL_S - 100 };
  }

  async function poll(mine) {
    await authenticate(mine);
    if (mine !== generation) return;
    // A pack over 5 groups is two requests: side by side, not one after the other (#67).
    await Promise.all(chunks.map((chunk) => pollChunk(chunk, mine)));
  }

  async function pollChunk(chunk, mine) {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(KEYS, { sub: Number(session.uid), utk: session.token }, now);
    const res = await nativeFetch(`${BCFY_LIVE_URL}?${liveQuery(chunk)}`, 20000, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (mine !== generation) return; // stopped, or another pack started, while this was out
    if (res.status === 402) throw fatal('Broadcastify prepaid balance is empty. Top up at bcfy.io/dev.');
    if (res.status === 401) {
      session = null;
      throw new Error('Broadcastify session expired; signing in again.');
    }
    if (res.status === 429) return; // rate limited: skip this round
    if (!res.ok) throw new Error(`Calls API answered HTTP ${res.status}.`);
    const answer = await res.json();
    if (mine !== generation) return;
    const first = !chunk.pos;
    if (Number.isFinite(Number(answer.lastPos))) chunk.pos = Number(answer.lastPos);
    const fresh = first ? recentOnly(newCalls(answer, seen), answer.serverTime) : newCalls(answer, seen);
    for (const call of fresh) {
      seen[call.key] = true;
      if (call.ts > lastCallTs) lastCallTs = call.ts;
    }
    // Two requests (a preset over 5 groups) can each bring calls: keep them in time order.
    queue = queue.concat(fresh).sort((a, b) => a.ts - b.ts).slice(-MAX_QUEUE);
    const serverNow = Number(answer.serverTime) > 0 ? Number(answer.serverTime) : now;
    callbacks.onStatus(queue.length ? `${queue.length} waiting` : idleStatus(lastCallTs, serverNow));
    playNext();
  }

  // One call at a time: a finished or failed call is "paused", so the next one starts.
  function playNext() {
    if (!running || !audio || !audio.paused) return;
    const call = queue.shift();
    if (!call) return;
    callbacks.onCall(call);
    audio.src = call.url;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      console.warn('calls: a call stalled, skipping it');
      if (!audio) return;
      audio.pause();
      playNext();
    }, call.duration * 1000 + STALL_MARGIN_MS);
    audio.play().catch((err) => {
      console.warn('calls play:', err);
      playNext();
    });
  }

  function callDone() {
    clearTimeout(stallTimer);
    playNext();
  }

  function tick() {
    if (polling) return;
    polling = true;
    const mine = generation;
    poll(mine)
      .then(
        () => {
          if (mine === generation) lastError = '';
        },
        (err) => {
          if (mine !== generation) return;
          console.warn('calls:', err);
          const message = err.message || 'The Calls API did not answer.';
          if (err.fatal) {
            stopPlayer();
            callbacks.onError(message, true);
            return;
          }
          if (message !== lastError) callbacks.onError(message, false);
          lastError = message;
        },
      )
      .then(() => {
        if (mine === generation) polling = false;
      });
  }

  function stopPlayer() {
    generation++;
    running = false;
    polling = false;
    lastError = '';
    clearInterval(timer);
    timer = null;
    clearTimeout(stallTimer);
    queue = [];
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio = null;
    }
  }

  return {
    start(groupIds, credentials) {
      stopPlayer();
      chunks = groupChunks(groupIds);
      if (!login || login.username !== credentials.username || login.password !== credentials.password) session = null;
      login = credentials;
      running = true;
      seen = {};
      queue = [];
      lastCallTs = 0;
      audio = new Audio();
      trackPlayer(audio);
      audio.preload = 'auto';
      audio.onended = callDone;
      audio.onerror = () => {
        console.warn('calls: audio failed', audio && audio.src);
        callDone();
      };
      callbacks.onStatus('signing in');
      tick();
      timer = setInterval(tick, BCFY_POLL_MS);
    },
    stop: stopPlayer,
    isRunning: () => running,
  };
}
