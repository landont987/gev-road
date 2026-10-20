// The LIVE CALLS player against a fake app bridge (GevNative.http), a fake
// <audio> and node's mock timers: how often it asks Broadcastify (each live
// request is billed), what happens when a pack is switched while a request is
// out, when the login is refused, and when one call's audio stalls.

import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__KEYS__ = { bcfyKeyId: 'kid', bcfySecret: 'secret', bcfyAppId: 'app' };

class FakeAudio {
  constructor() {
    this.paused = true;
    this.src = '';
    this.played = [];
    FakeAudio.all.push(this);
  }
  play() {
    this.paused = false;
    this.played.push(this.src);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute() {
    this.src = '';
  }
  getAttribute() {
    return this.src;
  }
  addEventListener() {}
}
FakeAudio.all = [];
globalThis.Audio = FakeAudio;

let requests = []; // { url, answer(status, bodyObject) }
let autoLogin = true;
globalThis.window = {
  crypto: globalThis.crypto,
  GevNative: {
    http(id, method, url) {
      const answer = (status, body) => window.gevOnHttp(id, status, JSON.stringify(body || {}), -1);
      if (url.indexOf('/auth') >= 0 && autoLogin) {
        setImmediate(() => answer(200, { uid: 7, token: 'tok', exp: 4102444800 }));
        return;
      }
      requests.push({ url, answer });
    },
  },
};

const { createCallsPlayer, MAX_GROUPS_PER_REQUEST } = await import('../web/src/calls.js');

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const liveRequests = () => requests.filter((r) => r.url.indexOf('/live/') >= 0);
const call = (groupId, ts, name, duration) => ({ groupId, ts, descr: '', duration: duration || 3, url: `https://calls.example/${name}.mp3` });

let events;
function player() {
  events = { errors: [], statuses: [] };
  return createCallsPlayer({
    onStatus: (t) => events.statuses.push(t),
    onCall: () => {},
    onError: (message, fatal) => events.errors.push({ message, fatal: !!fatal }),
  });
}
const LOGIN = { username: 'u', password: 'p' };

beforeEach(() => {
  requests = [];
  autoLogin = true;
  FakeAudio.all = [];
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
});
afterEach(() => mock.timers.reset());

test('a slow answer is never asked for twice: no new poll starts while one is out', async () => {
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  assert.equal(liveRequests().length, 1);
  mock.timers.tick(6000); // the next poll is due, the first answer has not come
  await settle();
  mock.timers.tick(6000);
  await settle();
  assert.equal(liveRequests().length, 1, 'each extra request is billed');
  liveRequests()[0].answer(200, { lastPos: 100, serverTime: 100, calls: [] });
  await settle();
  mock.timers.tick(6000);
  await settle();
  assert.equal(liveRequests().length, 2, 'polling goes on once the answer is in');
  p.stop();
});

test('switching packs drops the old pack answer that arrives late', async () => {
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  const old = liveRequests()[0];
  p.start(['3759-1055'], LOGIN); // another pack while the first request is out
  await settle();
  old.answer(200, { lastPos: 100, serverTime: 100, calls: [call('2508-2991', 99, 'old-pack')] });
  await settle();
  const audio = FakeAudio.all[FakeAudio.all.length - 1];
  assert.deepEqual(audio.played, [], 'a call from the pack that was switched off must not play');
  p.stop();
});

test('a refused login stops the player instead of retrying every 6 seconds', async () => {
  autoLogin = false;
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  const auth = requests.filter((r) => r.url.indexOf('/auth') >= 0);
  assert.equal(auth.length, 1);
  auth[0].answer(401, {});
  await settle();
  assert.equal(events.errors.length, 1);
  assert.equal(events.errors[0].fatal, true);
  assert.equal(p.isRunning(), false);
  mock.timers.tick(30000);
  await settle();
  assert.equal(requests.filter((r) => r.url.indexOf('/auth') >= 0).length, 1, 'no new login attempts');
});

test('an empty prepaid balance stops the player', async () => {
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  liveRequests()[0].answer(402, {});
  await settle();
  assert.equal(events.errors.length, 1);
  assert.equal(events.errors[0].fatal, true);
  assert.equal(p.isRunning(), false);
  mock.timers.tick(30000);
  await settle();
  assert.equal(liveRequests().length, 1);
});

test('the same passing error is reported once, not on every poll', async () => {
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  for (let i = 0; i < 3; i++) {
    liveRequests()[i].answer(503, {});
    await settle();
    mock.timers.tick(6000);
    await settle();
  }
  assert.equal(events.errors.length, 1, 'a hotspot outage must not toast every 6 seconds');
  assert.equal(events.errors[0].fatal, false);
  assert.equal(p.isRunning(), true);
  p.stop();
});

test('a call whose audio stalls is skipped, so later calls still play', async () => {
  const p = player();
  p.start(['2508-2991'], LOGIN);
  await settle();
  liveRequests()[0].answer(200, {
    lastPos: 100,
    serverTime: 100,
    calls: [call('2508-2991', 98, 'stalls', 4), call('2508-2991', 99, 'next', 4)],
  });
  await settle();
  const audio = FakeAudio.all[FakeAudio.all.length - 1];
  assert.deepEqual(audio.played, ['https://calls.example/stalls.mp3']);
  mock.timers.tick(60000); // never "ended", never "error": the hotspot stalled mid-file
  await settle();
  assert.equal(audio.played[1], 'https://calls.example/next.mp3');
  p.stop();
});

test('at most 5 groups go in one request', () => {
  assert.equal(MAX_GROUPS_PER_REQUEST, 5);
});
