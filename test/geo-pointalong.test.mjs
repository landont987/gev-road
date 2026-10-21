// pointAlong must not throw on a degenerate route (a bad demo parseRoute result),
// since it runs inside the unwrapped demo onFix path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAlong } from '../web/src/geo.js';

test('pointAlong returns a safe point for an empty or single-point route', () => {
  assert.deepEqual(pointAlong([], 100), { lat: 0, lon: 0, bearing: 0, done: true });
  assert.deepEqual(pointAlong([[-112.07, 33.45]], 100), { lat: 33.45, lon: -112.07, bearing: 0, done: true });
});

test('pointAlong still walks a real two-point route', () => {
  const p = pointAlong([[-112.0, 33.0], [-112.0, 33.1]], 0);
  assert.ok(Math.abs(p.lat - 33.0) < 1e-9 && Math.abs(p.lon + 112.0) < 1e-9);
});
