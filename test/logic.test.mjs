import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  distanceM,
  bearingDeg,
  cumulativeM,
  projectOntoLine,
  tileFor,
  tilesForBounds,
  tileCount,
  pickTileZoom,
  pointAlong,
} from '../web/src/geo.js';
import { parseAzCameras, parseAlprTile, parsePlaces } from '../web/src/parse.js';
import {
  formatRef,
  instructionFor,
  parseRoute,
  routeProgress,
  formatDistance,
  formatDuration,
} from '../web/src/route-logic.js';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const readJson = (name) => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));

test('distance from Chase Field to the Capitol is about 2.85 km', () => {
  const d = distanceM({ lat: 33.4455, lon: -112.0667 }, { lat: 33.4482, lon: -112.0973 });
  assert.ok(d > 2800 && d < 2900, `got ${d}`);
});

test('bearing due north is 0 and due east is 90', () => {
  assert.ok(Math.abs(bearingDeg({ lat: 33, lon: -112 }, { lat: 34, lon: -112 })) < 0.01);
  assert.ok(Math.abs(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 0.01);
});

test('downtown Phoenix falls in z12 tile 772/1643', () => {
  assert.deepEqual(tileFor(33.4484, -112.074, 12), { x: 772, y: 1643 });
});

test('a city-sized view picks the finest plate-reader zoom that stays within 16 tiles', () => {
  const box = { south: 33.4, west: -112.15, north: 33.5, east: -112.0 };
  const z = pickTileZoom(box, 9, 12, 16);
  assert.equal(z, 12);
  assert.ok(tilesForBounds(box, z).length <= 16);
});

test('a whole-state view is too wide, so the driver is asked to zoom in', () => {
  const box = { south: 31.3, west: -114.8, north: 37.0, east: -109.0 };
  assert.equal(pickTileZoom(box, 9, 12, 16), null);
});

test('projection reports zero offset on the line and the right distance along it', () => {
  const coords = [
    [-112.0, 33.0],
    [-112.0, 33.01],
    [-112.0, 33.02],
  ];
  const cum = cumulativeM(coords);
  const snap = projectOntoLine({ lat: 33.015, lon: -112.0 }, coords, cum);
  assert.ok(snap.offM < 0.5);
  assert.ok(Math.abs(snap.alongM - cum[2] * 0.75) < 2);
});

test('projection reports the sideways distance for a point off the line', () => {
  const coords = [
    [-112.0, 33.0],
    [-112.0, 33.02],
  ];
  const off = projectOntoLine({ lat: 33.01, lon: -111.998 }, coords, cumulativeM(coords)).offM;
  assert.ok(off > 180 && off < 195, `got ${off}`); // 0.002 deg of longitude at 33N is about 186 m
});

test('pointAlong walks the line and flags the end', () => {
  const coords = [
    [-112.0, 33.0],
    [-112.0, 33.01],
  ];
  const mid = pointAlong(coords, 500);
  assert.ok(Math.abs(mid.lat - 33.0045) < 0.0002);
  assert.equal(mid.done, false);
  assert.equal(pointAlong(coords, 5000).done, true);
});

test('real ADOT camera rows parse into map points with az511 picture links', () => {
  const cams = parseAzCameras(readJson('az-cameras-sample.json'));
  assert.equal(cams.length, 5);
  for (const c of cams) {
    assert.match(c.imageUrl, /^https:\/\/az511\.com\/map\/Cctv\/\d+$/);
    assert.ok(c.lat > 31 && c.lat < 37.1 && c.lon > -115 && c.lon < -109, 'inside Arizona');
  }
});

test('camera rows with a missing or foreign picture link are dropped', () => {
  const cams = parseAzCameras({
    features: [
      { attributes: { Id: 1, Views: 'http://63.42.42.191:8081/snap.jpg' }, geometry: { x: -112, y: 33 } },
      { attributes: { Id: 2, Views: null }, geometry: { x: -112, y: 33 } },
      { attributes: { Id: 3, Views: 'https://az511.com/map/Cctv/5' }, geometry: { x: 'bad', y: 33 } },
    ],
  });
  assert.equal(cams.length, 0);
});

test('a real Phoenix plate-reader tile decodes into points inside the tile', () => {
  const bytes = fs.readFileSync(fixture('alpr-11-386-821.mvt'));
  const records = parseAlprTile(bytes, 11, 386, 821);
  assert.ok(records.length > 0);
  for (const r of records) {
    assert.ok(r.lat > 33.4 && r.lat < 33.62 && r.lon > -112.15 && r.lon < -111.9, `${r.lat},${r.lon}`);
    assert.ok(r.id.length > 0);
  }
});

test('real Photon results become labelled places', () => {
  const places = parsePlaces(readJson('photon-chase-field.json'));
  assert.ok(places.length > 0);
  assert.equal(places[0].title, 'Chase Field');
  assert.match(places[0].detail, /Phoenix/);
});

test('route refs read like road signs', () => {
  assert.equal(formatRef('I 17; US 60'), 'I-17 / US-60');
  assert.equal(formatRef(''), '');
});

test('instructions for the step types OSRM returns', () => {
  assert.equal(
    instructionFor({ maneuver: { type: 'turn', modifier: 'right' }, name: 'East Jefferson Street' }),
    'Turn right onto East Jefferson Street',
  );
  assert.equal(instructionFor({ maneuver: { type: 'turn', modifier: 'slight left' }, name: 'A St' }), 'Bear left onto A St');
  assert.equal(instructionFor({ maneuver: { type: 'turn', modifier: 'uturn' }, name: 'A St' }), 'Make a U-turn');
  assert.equal(
    instructionFor({
      maneuver: { type: 'off ramp', modifier: 'slight right' },
      name: '',
      exits: '143A',
      destinations: 'I 17 North: Flagstaff',
    }),
    'Take exit 143A toward I-17 North: Flagstaff',
  );
  assert.equal(
    instructionFor({ maneuver: { type: 'merge', modifier: 'slight left' }, name: 'Black Canyon Freeway', ref: 'I 17; US 60' }),
    'Merge onto Black Canyon Freeway (I-17 / US-60)',
  );
  assert.equal(instructionFor({ maneuver: { type: 'arrive' }, name: 'X' }), 'Arrive at your destination');
});

test('the real Phoenix to Deer Valley route parses with every step placed along it', () => {
  const route = parseRoute(readJson('osrm-phx-to-deer-valley.json'));
  assert.equal(route.steps.length, 14);
  assert.ok(route.distanceM > 30000 && route.distanceM < 32000);
  assert.ok(Math.abs(route.scale - 1) < 0.02, `scale ${route.scale}`);
  for (let i = 1; i < route.steps.length; i++) assert.ok(route.steps[i].atM >= route.steps[i - 1].atM);
});

test('progress at the start points at the first turn; near the end it has arrived', () => {
  const route = parseRoute(readJson('osrm-phx-to-deer-valley.json'));
  const start = { lon: route.coords[0][0], lat: route.coords[0][1] };
  const p0 = routeProgress(route, start);
  assert.equal(p0.next.text, 'Turn right onto East Jefferson Street');
  assert.ok(p0.offM < 1);
  assert.ok(p0.remainingM > 30000);
  const last = route.coords[route.coords.length - 1];
  assert.equal(routeProgress(route, { lon: last[0], lat: last[1] }).arrived, true);
});

test('progress on the I-17 stretch names the Deer Valley exit, even with sparse GPS fixes', () => {
  const route = parseRoute(readJson('osrm-phx-to-deer-valley.json'));
  const exitStep = route.steps.find((s) => s.text.startsWith('Take exit 215A'));
  assert.ok(exitStep, 'route has the exit 215A step');
  // A fix 1 km before the exit, located by walking the route geometry.
  const pos = pointAlong(route.coords, (exitStep.atM - 1000) / route.scale);
  const p = routeProgress(route, pos);
  assert.equal(p.next.text, exitStep.text);
  assert.ok(Math.abs(p.toNextM - 1000) < 30, `toNext ${p.toNextM}`);
});

test('a fix far from the route reports a large offset', () => {
  const route = parseRoute(readJson('osrm-phx-to-deer-valley.json'));
  const p = routeProgress(route, { lat: 33.3, lon: -111.8 }); // Gilbert, nowhere near
  assert.ok(p.offM > 10000);
});

test('a failed route answer throws a readable error', () => {
  assert.throws(() => parseRoute({ code: 'NoRoute', message: 'Impossible route' }), /Impossible route/);
});

test('distances and times read like a car display', () => {
  assert.equal(formatDistance(30), '100 ft');
  assert.equal(formatDistance(1609.344 * 2.25), '2.3 mi');
  assert.equal(formatDistance(1609.344 * 42), '42 mi');
  assert.equal(formatDuration(17 * 60), '17 min');
  assert.equal(formatDuration(95 * 60), '1 h 35 min');
});

test('tile counting is arithmetic, so a world view cannot build millions of tiles', () => {
  const world = { south: -80, west: -179, north: 80, east: 179 };
  const started = Date.now();
  assert.equal(pickTileZoom(world, 9, 12, 16), null);
  assert.ok(Date.now() - started < 50, 'returns at once');
  const city = { south: 33.4, west: -112.15, north: 33.5, east: -112.0 };
  assert.equal(tileCount(city, 12), tilesForBounds(city, 12).length);
});

// Out 2 km north, U-turn, back 2 km on a carriageway 23 m to the east.
function outAndBackRoute() {
  const out = [];
  const back = [];
  for (let i = 0; i <= 20; i++) out.push([-112.0, 33.0 + i * 0.0009]);
  for (let i = 20; i >= 0; i--) back.push([-111.99975, 33.0 + i * 0.0009]);
  const coords = out.concat(back);
  const outM = cumulativeM(out).pop();
  const turnM = cumulativeM([out[out.length - 1], back[0]]).pop();
  const backM = cumulativeM(back).pop();
  const step = (type, modifier, distance) => ({ maneuver: { type, modifier }, name: 'Test Rd', distance });
  return parseRoute({
    code: 'Ok',
    routes: [
      {
        distance: outM + turnM + backM,
        duration: 300,
        geometry: { coordinates: coords },
        legs: [{ steps: [step('depart', 'straight', outM), step('turn', 'uturn', turnM + backM), step('arrive', '', 0)] }],
      },
    ],
  });
}

test('on a route that doubles back beside itself, progress stays on the pass the truck is on', () => {
  const route = outAndBackRoute();
  // Truck 500 m up the outbound side, GPS drifted 12 m toward the return side.
  const fix = { lat: 33.0 + 500 / 111000, lon: -112.0 + 12 / (111320 * Math.cos((33 * Math.PI) / 180)) };
  const global = routeProgress(route, fix);
  assert.equal(global.next.text, 'Arrive at your destination', 'whole-route snap jumps to the return pass');
  const p = routeProgress(route, fix, 490);
  assert.equal(p.next.text, 'Make a U-turn');
  assert.ok(p.remainingM > 3400, `remaining ${p.remainingM}`);
});

test('after a long GPS gap the window misses and the whole route is searched', () => {
  const route = outAndBackRoute();
  const fix = { lat: 33.0 + 1900 / 111000, lon: -112.0 };
  const p = routeProgress(route, fix, 0); // last known at the start, now 1.9 km on
  assert.ok(p.offM < 5);
  assert.ok(Math.abs(p.alongM - 1900) < 30, `along ${p.alongM}`);
});

test('a no-route answer is tagged so the driver gets the right message', () => {
  try {
    parseRoute({ code: 'NoRoute', message: 'Impossible route between points' });
    assert.fail('should throw');
  } catch (err) {
    assert.equal(err.noRoute, true);
  }
});
