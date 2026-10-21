// Only the dots on screen (plus a margin) are DOM markers: the head unit's
// MT8163 moves every marker in the map pane on each GPS recenter, and the
// full lists are about 1,000 dots (#47). The lists themselves stay whole for
// the spoken alerts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeMap } from './helpers/dom.mjs';
import { padBox, cullDots, VIEW_PAD } from '../web/src/dots-logic.js';

const PHX = { south: 33.4, west: -112.1, north: 33.5, east: -112.0 };

test('padBox widens the screen by the given fraction on every side', () => {
  const box = padBox(PHX, 0.5);
  assert.deepEqual(box, { south: 33.35, west: -112.15, north: 33.55, east: -111.95 });
  assert.ok(VIEW_PAD > 0 && VIEW_PAD <= 1, 'the margin is a fraction of the screen');
});

test('cullDots adds the spots inside the box and removes the drawn ones outside it', () => {
  const inside = { lat: 33.45, lon: -112.05 };
  const edge = { lat: 33.4, lon: -112.1 };
  const far = { lat: 35.2, lon: -111.65 }; // Flagstaff
  const drawn = new Set([far]);
  const { add, remove } = cullDots([inside, edge, far], PHX, drawn);
  assert.deepEqual(add, [inside, edge]);
  assert.deepEqual(remove, [far]);
});

test('cullDots leaves a drawn spot alone when it is still on screen', () => {
  const inside = { lat: 33.45, lon: -112.05 };
  const { add, remove } = cullDots([inside], PHX, new Set([inside]));
  assert.deepEqual(add, []);
  assert.deepEqual(remove, []);
});

test('the dot layer draws only the spots near the screen and follows the map', async () => {
  const { markers } = await import('./helpers/fake-leaflet.mjs');
  const { createDotLayer } = await import('../web/src/dots.js');
  const map = fakeMap(PHX);
  const layer = createDotLayer(map);
  const spots = [
    { lat: 33.45, lon: -112.05, kind: 'camera', onTap() {} }, // downtown
    { lat: 33.52, lon: -112.05, kind: 'camera', onTap() {} }, // just north, inside the margin
    { lat: 35.2, lon: -111.65, kind: 'camera', onTap() {} }, // Flagstaff
  ];
  layer.setSpots(spots);
  assert.equal(layer.count(), 0, 'nothing is drawn until the layer is switched on');
  layer.setEnabled(true);
  assert.equal(layer.count(), 2);
  assert.equal(markers.filter((m) => m.latlng[0] === 35.2).length, 0, 'Flagstaff is not a DOM marker');

  map.moveTo({ south: 35.1, west: -111.7, north: 35.3, east: -111.6 }); // drive to Flagstaff
  assert.equal(layer.count(), 1, 'only Flagstaff is drawn there');
  assert.equal(map.layers.length, 1, 'the group is on the map once');

  layer.setEnabled(false);
  assert.equal(layer.count(), 0);
  assert.equal(map.layers.length, 0, 'the group left the map');
});

test('pickDots keeps the max nearest the center, and everything when under the cap', async () => {
  const { pickDots } = await import('../web/src/dots-logic.js');
  const center = { lat: 33.45, lon: -112.05 };
  const near = { lat: 33.451, lon: -112.051 };
  const mid = { lat: 33.46, lon: -112.06 };
  const farInBox = { lat: 33.49, lon: -112.01 };
  const outside = { lat: 35.2, lon: -111.65 };
  assert.deepEqual(pickDots([farInBox, near, mid, outside], PHX, center, 2), [near, mid]);
  assert.deepEqual(pickDots([farInBox, near, mid, outside], PHX, center, 10), [farInBox, near, mid]);
  assert.deepEqual(pickDots([farInBox, near, mid], PHX, null, 2), [farInBox, near], 'no center: list order');
});

test('cullDots with a cap removes a drawn dot that fell out of the nearest set', async () => {
  const center = { lat: 33.45, lon: -112.05 };
  const near = { lat: 33.451, lon: -112.051 };
  const farInBox = { lat: 33.49, lon: -112.01 };
  const { add, remove } = cullDots([near, farInBox], PHX, new Set([farInBox]), { center, max: 1 });
  assert.deepEqual(add, [near]);
  assert.deepEqual(remove, [farInBox]);
});

test('the dot layer draws nothing below the minimum zoom and never more than the cap', async () => {
  const { markers } = await import('./helpers/fake-leaflet.mjs');
  const { createDotLayer } = await import('../web/src/dots.js');
  const { MIN_DOT_ZOOM, MAX_DOTS } = await import('../web/src/dots-logic.js');
  const map = fakeMap(PHX, MIN_DOT_ZOOM - 1);
  const layer = createDotLayer(map);
  const spots = [];
  for (let i = 0; i < MAX_DOTS + 50; i++) spots.push({ lat: 33.4 + (i % 50) * 0.002, lon: -112.1 + Math.floor(i / 50) * 0.01, kind: 'camera', onTap() {} });
  layer.setEnabled(true);
  layer.setSpots(spots);
  assert.equal(layer.count(), 0, 'a city-wide view shows no dots');
  map.zoom = MIN_DOT_ZOOM;
  map.fire('moveend');
  assert.equal(layer.count(), MAX_DOTS, 'zoomed in: the cap applies');
  map.zoom = MIN_DOT_ZOOM - 1;
  map.fire('moveend');
  assert.equal(layer.count(), 0, 'zooming back out clears them');
  assert.ok(markers.length >= MAX_DOTS);
});
