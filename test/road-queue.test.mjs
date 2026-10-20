// Road info cards wait in a queue while another card shows (7 s or more each).
// A card whose spot the truck has already passed by the time its turn comes
// must be dropped, not shown with an old "0.4 mi".

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/dom.mjs';

globalThis.__KEYS__ = { az511: 'test' };
const HOME = { lat: 33.5, lon: -112.07 };
const north = (m) => ({ lat: HOME.lat + m / 111320, lon: HOME.lon });
// Six highway signs 400-900 m north of the truck, northbound.
const SIGNS = [400, 500, 600, 700, 800, 900].map((m, i) =>
  Object.assign({ Id: i + 1, Name: `Sign ${i + 1}`, Roadway: 'I-17', DirectionOfTravel: 'Northbound', Messages: [`MESSAGE ${i + 1}`] }, { Latitude: north(m).lat, Longitude: north(m).lon }),
);
globalThis.fetch = (url) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.indexOf('messagesigns') >= 0 ? SIGNS : []) });

const { createRoad } = await import('../web/src/road.js');

test('queued cards for signs the truck has already passed are dropped', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let fix = Object.assign({}, HOME, { bearing: 0, speed: 30 });
  const shown = [];
  const box = document.getElementById('popup');
  const road = createRoad({
    map: { removeLayer() {} },
    voice: { alert() {} },
    settings: {},
    app: { isLowData: () => false },
    getFix: () => fix,
  });
  road.setEnabled(true);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  const record = () => {
    if (!box.hidden && shown[shown.length - 1] !== box.textContent) shown.push(box.textContent);
  };
  for (let i = 0; i < 3; i++) {
    road.onFix(fix); // two cards per fix: six cards, one shows, five wait
    record();
  }
  assert.equal(shown.length, 1);
  fix = Object.assign({}, north(3000), { bearing: 0, speed: 30 }); // 3 km on: every sign is behind
  road.onFix(fix);
  for (let s = 0; s < 120; s++) {
    mock.timers.tick(1000);
    record();
  }
  mock.timers.reset();
  assert.equal(shown.length, 1, `signs behind the truck were still shown: ${shown.slice(1).join(' | ')}`);
});

test('stillDueM: ahead and in range gives meters, passed or out of range gives null', async () => {
  const { stillDueM } = await import('../web/src/road-logic.js');
  const sign = { id: 'sign:1', kind: 'sign', lat: north(800).lat, lon: HOME.lon, directionDeg: 0 };
  const drivingNorth = (m) => Object.assign({}, north(m), { bearing: 0, speed: 30 });
  assert.ok(Math.abs(stillDueM(sign, drivingNorth(0)) - 800) < 2);
  assert.equal(stillDueM(sign, drivingNorth(1000)), null, 'passed');
  assert.equal(stillDueM(sign, drivingNorth(-3000)), null, 'still too far');
  assert.equal(stillDueM(sign, Object.assign({}, HOME, { bearing: 180, speed: 30 })), null, 'heading away');
  assert.equal(stillDueM({ kind: 'nope', lat: 0, lon: 0 }, drivingNorth(0)), null);
});
