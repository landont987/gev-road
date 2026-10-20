// Speed from the last two fixes when the unit reports none (#57): a gap
// shorter than half a second keeps the previous speed instead of flipping
// "moving" off for one fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpeed } from '../web/src/fix-logic.js';

const at = (lat, lon, speed) => ({ lat, lon, speed, bearing: 0, accuracy: 5 });

test('a reported speed is kept as is', () => {
  assert.equal(withSpeed(at(33.45, -112.07, 12), at(33.45, -112.07, 0), 1000, 2000).speed, 12);
});

test('no speed: computed from the distance over a normal gap', () => {
  const prev = at(33.45, -112.07, null);
  const next = at(33.45 + 20 / 111320, -112.07, null); // 20 m north
  assert.equal(Math.round(withSpeed(next, prev, 1000, 2000).speed), 20);
});

test('no speed and a gap under half a second: the previous speed carries over', () => {
  const prev = at(33.45, -112.07, 18);
  const next = at(33.45, -112.07, null);
  assert.equal(withSpeed(next, prev, 1000, 1200).speed, 18);
});

test('no speed after a GPS dropout: speed stays unknown', () => {
  const prev = at(33.45, -112.07, 18);
  const next = at(33.46, -112.07, null);
  assert.equal(withSpeed(next, prev, 1000, 9000).speed, null);
  assert.equal(withSpeed(next, null, 0, 9000).speed, null);
});
