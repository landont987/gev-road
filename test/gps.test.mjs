// The Android app's pushes into the page (#64): fixes carry their provider,
// the GPS state reaches the hook, and a last known position centers the map
// once without counting as a fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMap } from './helpers/dom.mjs';

globalThis.window = globalThis.window || {};
const { createGps } = await import('../web/src/gps.js');
const { createTruck } = await import('../web/src/truck.js');

test('truck source: a fix carries its provider and the status reaches the hook', () => {
  window.GevNative = { gpsStatusJson: () => JSON.stringify({ satellites: 7, used: 7, lastFixAgeS: 1 }) };
  const fixes = [];
  const statuses = [];
  const gps = createGps((fix) => fixes.push(fix), { onStatus: (s) => statuses.push(s) });
  assert.equal(gps.source(), 'truck');
  window.gevOnLocation(33.4, -112.1, 12.5, 90, 4, 'gps');
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].provider, 'gps');
  assert.equal(fixes[0].speed, 12.5);
  window.gevOnLocation(33.4, -112.1, -1, -1, 50);
  assert.equal(fixes[1].provider, '');
  assert.equal(fixes[1].speed, null);

  window.gevOnGpsStatus(JSON.stringify({ locationOn: false, satellites: 0 }));
  assert.equal(statuses.length, 1);
  assert.equal(gps.status().locationOn, false);
  window.gevOnGpsStatus('{not json');
  assert.equal(statuses.length, 1, 'bad JSON is ignored');

  assert.equal(gps.readStatus().satellites, 7, 'readStatus asks the app');
  delete window.GevNative;
});

test('last known position: the start view only, and only before the first fix', () => {
  window.GevNative = {};
  const map = fakeMap();
  const truck = createTruck(map, () => {});
  const seen = [];
  createGps(() => {}, { onLastKnown: (p) => { seen.push(p); truck.setStart(p); } });
  window.gevOnLastKnown(33.6, -112.2, '3600');
  assert.deepEqual(seen, [{ lat: 33.6, lon: -112.2, ageS: 3600 }]);
  assert.equal(map.views.length, 1, 'the map moved to where the truck was parked');
  truck.update({ lat: 33.61, lon: -112.21, speed: 0, bearing: null, accuracy: 5 });
  truck.setStart({ lat: 33.0, lon: -112.0 });
  assert.equal(map.views.length, 2, 'a last known position after a real fix is ignored');
  delete window.GevNative;
});
