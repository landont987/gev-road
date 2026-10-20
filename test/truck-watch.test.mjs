// The AI truck check's timing: a check a few seconds after the stop, then one
// more on the camera's next picture when the first one did not show the truck.
// Runs truck-check.js against a fake app bridge, a fake clock and a tiny fake DOM.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fakeNode = () => ({
  appendChild() {},
  addEventListener() {},
  setAttribute() {},
  classList: { add() {}, remove() {}, toggle() {} },
  style: {},
  textContent: '',
  hidden: true,
});
const nodes = {};
globalThis.document = {
  getElementById: (id) => (nodes[id] = nodes[id] || fakeNode()),
  createElement: fakeNode,
  createTextNode: (text) => ({ text }),
  body: fakeNode(),
};
globalThis.__KEYS__ = { gemini: 'test-key', truckDescription: 'red 2014 Toyota Tundra' };

let clock = 0;
Date.now = () => clock;

const calls = []; // { kind: 'picture' | 'list' | 'gemini', url, headers }
// The first look (vehicleListBody) answers from this; by default a red pickup
// where SEEN boxes the truck, so the comparison (kind 'gemini') runs.
const LIST_RED = '{"vehicles": [{"color": "red", "body": "pickup", "box_2d": [400, 300, 600, 500]}]}';
const LIST_SEMI = '{"vehicles": [{"color": "white", "body": "semi truck", "box_2d": [363, 76, 407, 110]}]}';
let listAnswer = LIST_RED;
let pictures = []; // answers for picture requests, in order: { base64, age }
let geminiAnswers = []; // answers for Gemini requests, in order: model text
globalThis.window = {
  GevNative: {
    httpEx(id, method, url, headersJson, body) {
      const headers = JSON.parse(headersJson);
      if (body && body.indexOf('You list the vehicles') >= 0) {
        calls.push({ kind: 'list', url, headers });
        const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: listAnswer }] }, finishReason: 'STOP' }] });
        setImmediate(() => window.gevOnHttp(id, 200, answer, -1));
      } else if (url.indexOf('https://az511.com/') === 0) {
        calls.push({ kind: 'picture', url, headers });
        const p = pictures.shift();
        setImmediate(() => window.gevOnHttp(id, 200, p.base64, p.age));
      } else {
        calls.push({ kind: 'gemini', url, headers });
        const text = geminiAnswers.shift();
        const body = JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
        setImmediate(() => window.gevOnHttp(id, 200, body, -1));
      }
    },
  },
};
globalThis.fetch = () => Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });

const { createTruckCheck } = await import('../web/src/truck-check.js');

const jpeg = fs.readFileSync(new URL('./fixtures/adot-960-head.jpg', import.meta.url));
const picture = (tag) => Buffer.concat([jpeg, Buffer.from(tag)]).toString('base64');
const NOT_SEEN = '{"found": false, "confidence": "high", "box_2d": null, "note": "No red pickups."}';
const SEEN = '{"candidate": {"color": "red", "body": "pickup"}, "found": true, "confidence": "high", "box_2d": [400, 300, 600, 500], "note": "Left lane."}';

const CAM = { id: '960', name: 'I-10 @Tunnel EB', lat: 33.45, lon: -112.07, imageUrl: 'https://az511.com/map/Cctv/960' };
const stopped = { source: 'truck', lat: 33.4505, lon: -112.0705, speed: 0, bearing: null };
const moving = Object.assign({}, stopped, { speed: 15 });
// Lets each fake bridge answer (one setImmediate per request) and the promise
// chain after it finish. Counted in event-loop turns, not milliseconds, so a busy
// machine cannot cut a check short (a 5 ms timer did, once).
const flush = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
};

let said;
let check;
beforeEach(() => {
  clock = 1000000;
  calls.length = 0;
  pictures = [];
  geminiAnswers = [];
  said = [];
  listAnswer = LIST_RED;
  check = createTruckCheck({
    app: { isMoving: () => false, isLowData: () => false, isOnline: () => true },
    cameras: { list: () => [CAM] },
    voice: { sayIfOn: (text) => said.push(text) },
    settings: { truckCheck: true },
  });
});

/** One GPS fix at this time, then let the fake bridge answer. */
async function fixAt(ms, fix) {
  clock = ms;
  check.onFix(fix || stopped);
  await flush();
}

// The first look happens before every comparison; these timing tests count pictures and comparisons.
const kinds = () => calls.filter((c) => c.kind !== 'list').map((c) => c.kind);

test('checks 3 seconds after the stop, then again the moment the camera posts its next picture', async () => {
  pictures = [
    { base64: picture('old'), age: 20 }, // taken 17 s before the stop
    { base64: picture('new'), age: -1 }, // fresh from the camera
  ];
  geminiAnswers = [NOT_SEEN, SEEN];
  await fixAt(1000000);
  await fixAt(1002000);
  assert.deepEqual(kinds(), [], 'not before 3 seconds');
  await fixAt(1003000);
  assert.deepEqual(kinds(), ['picture', 'gemini']);
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(calls[1].headers['x-goog-api-key'], 'test-key');
  // The old picture was taken at 983000, so the next one is up at 1013000.
  await fixAt(1010000);
  assert.equal(kinds().length, 2, 'waits for the next picture instead of polling');
  await fixAt(1014500);
  assert.deepEqual(kinds(), ['picture', 'gemini', 'picture', 'gemini']);
  assert.equal(said.length, 1);
  assert.match(said[0], /Your truck may be on the I 10 at Tunnel eastbound camera/);
  await fixAt(1030000);
  await fixAt(1060000);
  assert.equal(kinds().length, 4, 'nothing more at this stop');
});

test('a late new picture is looked at again 5 seconds later; the same picture never goes to Gemini twice', async () => {
  pictures = [
    { base64: picture('old'), age: 25 },
    { base64: picture('old'), age: 31 }, // the cache has not refreshed yet
    { base64: picture('new'), age: 1 },
  ];
  geminiAnswers = [NOT_SEEN, NOT_SEEN];
  await fixAt(1000000);
  await fixAt(1003000);
  await fixAt(1009500); // 978000 + 30000 + 1500
  assert.deepEqual(kinds(), ['picture', 'gemini', 'picture']);
  await fixAt(1012000);
  assert.equal(kinds().length, 3);
  await fixAt(1014500);
  assert.deepEqual(kinds(), ['picture', 'gemini', 'picture', 'picture', 'gemini']);
  assert.equal(said.length, 0);
});

test('no second check when the first picture was already taken after the stop, or when the truck was seen', async () => {
  pictures = [{ base64: picture('fresh'), age: 1 }];
  geminiAnswers = [NOT_SEEN];
  await fixAt(1000000);
  await fixAt(1003000);
  await fixAt(1040000);
  assert.deepEqual(kinds(), ['picture', 'gemini']);
});

test('driving off ends the wait for the next picture', async () => {
  pictures = [{ base64: picture('old'), age: 20 }];
  geminiAnswers = [NOT_SEEN];
  await fixAt(1000000);
  await fixAt(1003000);
  await fixAt(1005000, moving);
  await fixAt(1014500, moving);
  await fixAt(1016000, moving);
  assert.deepEqual(kinds(), ['picture', 'gemini']);
});

test('gives up on a camera whose picture never changes', async () => {
  const same = picture('frozen');
  pictures = [{ base64: same, age: 20 }].concat(Array.from({ length: 20 }, () => ({ base64: same, age: 5 })));
  geminiAnswers = [NOT_SEEN];
  await fixAt(1000000);
  await fixAt(1003000);
  for (let t = 1004000; t <= 1080000; t += 1000) await fixAt(t);
  assert.equal(kinds().filter((k) => k === 'gemini').length, 1);
  const lookups = kinds().filter((k) => k === 'picture').length;
  assert.ok(lookups <= 8, `${lookups} picture lookups`);
});

test('a manual check while waiting for the next picture ends the wait, so no picture goes to Gemini twice', async () => {
  pictures = [
    { base64: picture('old'), age: 20 },
    { base64: picture('new'), age: -1 },
    { base64: picture('new'), age: 10 },
  ];
  geminiAnswers = [NOT_SEEN, NOT_SEEN];
  await fixAt(1000000);
  await fixAt(1003000);
  clock = 1008000;
  assert.match(check.checkNow(stopped, clock), /^Checking /);
  await flush();
  await fixAt(1014500);
  await fixAt(1030000);
  assert.deepEqual(kinds(), ['picture', 'gemini', 'picture', 'gemini']);
});

test('a match found after the truck drove off speaks but opens no panel (nothing needs a tap while driving)', async () => {
  let drivingNow = false;
  check = createTruckCheck({
    app: { isMoving: () => drivingNow, isLowData: () => false, isOnline: () => true },
    cameras: { list: () => [CAM] },
    voice: { sayIfOn: (text) => said.push(text) },
    settings: { truckCheck: true },
  });
  pictures = [{ base64: picture('fresh'), age: 1 }];
  geminiAnswers = [SEEN];
  document.getElementById('sheet').hidden = true;
  await fixAt(1000000);
  drivingNow = true; // pulled away while Gemini was looking
  await fixAt(1003000);
  assert.equal(said.length, 1, 'the match is still spoken');
  assert.equal(document.getElementById('sheet').hidden, true, 'no panel slides over the map while driving');
});

test('a match found while still stopped opens the result panel', async () => {
  pictures = [{ base64: picture('fresh'), age: 1 }];
  geminiAnswers = [SEEN];
  document.getElementById('sheet').hidden = true;
  await fixAt(1000000);
  await fixAt(1003000);
  assert.equal(said.length, 1);
  assert.equal(document.getElementById('sheet').hidden, false);
});

test('a picture with no vehicle that could be the truck is not compared and never spoken', async () => {
  listAnswer = LIST_SEMI; // the white dump truck Gemini once called "a red Toyota Tundra"
  pictures = [{ base64: picture('fresh'), age: 1 }];
  geminiAnswers = [SEEN]; // would say "found" if it were asked
  await fixAt(1000000);
  await fixAt(1003000);
  assert.deepEqual(calls.map((c) => c.kind), ['picture', 'list'], 'no comparison request');
  assert.equal(said.length, 0);
  assert.match(check.lastText(), /not seen/);
});
