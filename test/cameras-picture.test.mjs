// The camera picture panel: since 0.3.3 pictures load while moving too, so
// starting or stopping must not swap a shown picture for a SHOW PICTURE button
// (that would need a tap while driving). Low data still takes it away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allNodes, fakeMap } from './helpers/dom.mjs';

const CAM = { id: '960', name: 'I-10 @Tunnel EB', road: 'I-10', direction: 'EB', lat: 33.45, lon: -112.07, imageUrl: 'https://az511.com/map/Cctv/960' };
globalThis.__KEYS__ = {};
globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ features: [] }) });

const { markers } = await import('./helpers/fake-leaflet.mjs');
const settings = await import('../web/src/settings.js');
settings.writeCache('gev-road-az-cameras', [CAM]);
const { createCameras } = await import('../web/src/cameras.js');

const created = [];
const createElement = document.createElement;
document.createElement = (tag) => {
  const node = createElement(tag);
  created.push(node);
  return node;
};
const lastImg = () => created.filter((n) => n.tag === 'img').pop();

const tick = () => new Promise((r) => setImmediate(r));
const sheet = () => allNodes(document.getElementById('sheet-body'));
const shownImg = () => sheet().filter((n) => n.tag === 'img')[0];
const buttons = () => sheet().filter((n) => n.tag === 'button').map((b) => b.textContent);

test('a shown picture stays when the truck starts or stops moving; low data still removes it', async () => {
  let moving = false;
  let lowData = false;
  const cams = createCameras(fakeMap(), { isMoving: () => moving, isLowData: () => lowData });
  cams.setEnabled(true);
  await tick();
  const dot = markers.filter((m) => m.latlng[0] === CAM.lat)[0];
  assert.ok(dot, 'the camera dot is on the map');
  dot.tap();
  const img = lastImg();
  assert.ok(img && /Cctv\/960/.test(img.src), 'the picture starts loading on the tap');
  img.naturalWidth = 960;
  img.naturalHeight = 540;
  img.onload();
  assert.ok(shownImg(), 'the picture is shown');

  moving = true;
  cams.refresh(); // main.js calls this when moving changes
  assert.ok(shownImg(), 'driving off keeps the picture');
  assert.equal(buttons().indexOf('SHOW PICTURE'), -1, 'no tap needed to see it again');

  lowData = true;
  cams.refresh(); // and when LOW DATA is switched
  assert.equal(shownImg(), undefined, 'low data hides it');
});
