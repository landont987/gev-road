// The map follows the truck again by itself after a stray finger drag while
// driving (#53): nothing may need a tap while moving, and RECENTER is a tap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMap } from './helpers/dom.mjs';

const { createTruck } = await import('../web/src/truck.js');

const fix = (speed) => ({ lat: 33.45, lon: -112.07, speed, bearing: 90, accuracy: 5 });

test('a drag stops following; while moving the map re-follows after 10 s with no touch', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const map = fakeMap();
  const states = [];
  const truck = createTruck(map, (following) => states.push(following));
  truck.update(fix(20));
  assert.equal(map.views.length, 1, 'following: the map recenters on the fix');

  map.fire('dragstart');
  assert.deepEqual(states, [false]);
  truck.update(fix(20));
  assert.equal(map.views.length, 1, 'not following after the drag');

  t.mock.timers.tick(5000);
  truck.update(fix(20));
  assert.equal(map.views.length, 1, 'still the driver\'s view 5 s after the touch');

  t.mock.timers.tick(6000);
  truck.update(fix(20));
  assert.deepEqual(states, [false, true], 're-followed after 10 s with no touch');
  assert.equal(map.views.length, 2, 'and the map recentred once');
});

test('parked, a drag keeps the driver\'s view until RECENTER', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const map = fakeMap();
  const states = [];
  const truck = createTruck(map, (following) => states.push(following));
  truck.update(fix(0));
  map.fire('dragstart');
  t.mock.timers.tick(60000);
  truck.update(fix(0));
  assert.deepEqual(states, [false], 'no re-follow while parked');
  truck.setFollowing(true);
  assert.deepEqual(states, [false, true]);
});

test('a drag that goes on resets the 10 s clock', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const map = fakeMap();
  const truck = createTruck(map, () => {});
  truck.update(fix(20));
  map.fire('dragstart');
  t.mock.timers.tick(8000);
  map.fire('drag');
  t.mock.timers.tick(4000);
  truck.update(fix(20));
  assert.equal(truck.isFollowing(), false, 'the finger was on the map 4 s ago');
  t.mock.timers.tick(7000);
  truck.update(fix(20));
  assert.equal(truck.isFollowing(), true);
});
