import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { dueAlerts, spokenPlace, alertText, angleDiff, cameraPlace } from '../web/src/alert-logic.js';
import { parseSpeedCameras } from '../web/src/parse.js';

// A truck on Central Ave in Phoenix, and a helper to place spots N/E of it in meters.
const HOME = { lat: 33.4484, lon: -112.074 };
function offset(northM, eastM) {
  return {
    lat: HOME.lat + northM / 111320,
    lon: HOME.lon + eastM / (111320 * Math.cos((HOME.lat * Math.PI) / 180)),
  };
}
const drivingNorth = Object.assign({}, HOME, { bearing: 0, speed: 20 });
const parked = Object.assign({}, HOME, { bearing: null, speed: 0 });

test('a plate reader 300 m ahead is spoken once, not on every GPS fix', () => {
  const spots = [Object.assign({ id: '1', kind: 'plate' }, offset(300, 0))];
  const first = dueAlerts(spots, drivingNorth, {});
  assert.deepEqual(first.alerts.map((a) => a.text), ['Plate reader ahead.']);
  const second = dueAlerts(spots, drivingNorth, first.spoken);
  assert.deepEqual(second.alerts, []);
});

test('a plate reader behind the truck is not spoken', () => {
  const spots = [Object.assign({ id: '1', kind: 'plate' }, offset(-300, 0))];
  assert.deepEqual(dueAlerts(spots, drivingNorth, {}).alerts, []);
});

test('a spoken spot speaks again only after the truck has been over 1 km away', () => {
  const spot = Object.assign({ id: '7', kind: 'plate' }, offset(300, 0));
  const spoken = dueAlerts([spot], drivingNorth, {}).spoken;
  const nearby = Object.assign({}, offset(-500, 0), { bearing: 0, speed: 20 }); // 800 m away
  assert.ok(dueAlerts([spot], nearby, spoken).spoken['plate:7'], 'still remembered at 800 m');
  const far = Object.assign({}, offset(-1000, 0), { bearing: 0, speed: 20 }); // 1300 m away
  const rearmed = dueAlerts([spot], far, spoken).spoken;
  assert.equal(rearmed['plate:7'], undefined);
  assert.equal(dueAlerts([spot], drivingNorth, rearmed).alerts.length, 1);
});

test('a spot missing from the list stays remembered', () => {
  const spot = Object.assign({ id: '7', kind: 'plate' }, offset(300, 0));
  const spoken = dueAlerts([spot], drivingNorth, {}).spoken;
  assert.ok(dueAlerts([], drivingNorth, spoken).spoken['plate:7']);
});

test('a traffic camera beside the road counts as in view, with a spoken name', () => {
  const spots = [Object.assign({ id: '1149', kind: 'camera', name: 'SR-202 @Mesa Dr' }, offset(0, 250))];
  assert.deepEqual(dueAlerts(spots, drivingNorth, {}).alerts.map((a) => a.text), [
    "You're in view of the Loop 202 at Mesa Drive camera.",
  ]);
});

// Real ADOT cameras 777, 779 and 781 are all "I-10 @Tunnel WB", about 220 m apart,
// and the eastbound ones sit beside them. Driving the tunnel says it once.
test('cameras sharing a name, either direction, are one place and speak once', () => {
  const tunnel = [
    Object.assign({ id: '777', kind: 'camera', name: 'I-10 @Tunnel WB', place: cameraPlace('I-10 @Tunnel WB') }, offset(0, 50)),
    Object.assign({ id: '779', kind: 'camera', name: 'I-10 @Tunnel WB', place: cameraPlace('I-10 @Tunnel WB') }, offset(220, 50)),
    Object.assign({ id: '781', kind: 'camera', name: 'I-10 @Tunnel WB', place: cameraPlace('I-10 @Tunnel WB') }, offset(440, 50)),
    Object.assign({ id: '778', kind: 'camera', name: 'I-10 @Tunnel EB', place: cameraPlace('I-10 @Tunnel EB') }, offset(110, -50)),
  ];
  let spoken = {};
  const said = [];
  for (let north = 0; north <= 700; north += 25) {
    const fix = Object.assign({}, offset(north, 0), { bearing: 0, speed: 25 });
    const r = dueAlerts(tunnel, fix, spoken);
    spoken = r.spoken;
    r.alerts.forEach((a) => said.push(a.text));
  }
  assert.deepEqual(said, ["You're in view of the I 10 at Tunnel camera."]);
});

test('the same spot twice in the list (tile overlap) speaks once and re-arms on the nearest copy', () => {
  const a = Object.assign({ id: '5', kind: 'plate' }, offset(300, 0));
  const copy = Object.assign({}, a);
  const first = dueAlerts([a, copy], drivingNorth, {});
  assert.equal(first.alerts.length, 1);
  assert.deepEqual(dueAlerts([a, copy], drivingNorth, first.spoken).alerts, []);
});

test('cameraPlace drops the direction so both sides of a road are one place', () => {
  assert.equal(cameraPlace('I-10 @Tunnel EB'), 'I-10 @Tunnel');
  assert.equal(cameraPlace('SR-189 @I-10 SB Ramps'), 'SR-189 @I-10 Ramps');
  assert.equal(cameraPlace('SR-202 @Mesa Dr'), 'SR-202 @Mesa Dr');
});

// Real bundled speed cameras 6237189551, 6237189803 and 6237190254 sit within
// about 50 m of each other in Tempe.
test('a cluster of same-kind spots speaks once, not once per camera', () => {
  const cluster = [
    Object.assign({ id: '6237189551', kind: 'speed', maxspeedMph: 40 }, offset(300, 0)),
    Object.assign({ id: '6237189803', kind: 'speed', maxspeedMph: 40 }, offset(300, -45)),
    Object.assign({ id: '6237190254', kind: 'speed', maxspeedMph: 40 }, offset(345, 0)),
  ];
  let spoken = {};
  const said = [];
  for (let north = -200; north <= 400; north += 20) {
    const fix = Object.assign({}, offset(north, 0), { bearing: 0, speed: 20 });
    const r = dueAlerts(cluster, fix, spoken);
    spoken = r.spoken;
    r.alerts.forEach((a) => said.push(a.text));
  }
  assert.deepEqual(said, ['Speed camera ahead, 40 miles per hour.']);
});

test('different kinds side by side still each speak', () => {
  const spots = [
    Object.assign({ id: '1', kind: 'speed' }, offset(200, 0)),
    Object.assign({ id: '2', kind: 'plate' }, offset(210, 0)),
  ];
  assert.equal(dueAlerts(spots, drivingNorth, {}).alerts.length, 2);
});

test('without a heading only very close spots count as ahead', () => {
  const near = Object.assign({ id: '1', kind: 'speed' }, offset(100, 0));
  const far = Object.assign({ id: '2', kind: 'speed' }, offset(200, 0));
  assert.deepEqual(dueAlerts([near, far], parked, {}).alerts.map((a) => a.key), ['speed:1']);
});

test('at most two alerts per fix, nearest first, and the rest wait for the next fix', () => {
  const spots = [
    Object.assign({ id: 'a', kind: 'plate' }, offset(350, 0)),
    Object.assign({ id: 'b', kind: 'redlight' }, offset(100, 0)),
    Object.assign({ id: 'c', kind: 'speed', maxspeedMph: 40 }, offset(200, 0)),
  ];
  const first = dueAlerts(spots, drivingNorth, {});
  assert.deepEqual(first.alerts.map((a) => a.text), ['Red light camera ahead.', 'Speed camera ahead, 40 miles per hour.']);
  assert.deepEqual(dueAlerts(spots, drivingNorth, first.spoken).alerts.map((a) => a.key), ['plate:a']);
});

test('plate and speed camera ids from OpenStreetMap never collide', () => {
  const spots = [
    Object.assign({ id: '8196828915', kind: 'plate' }, offset(100, 0)),
    Object.assign({ id: '8196828915', kind: 'speed' }, offset(100, 0)),
  ];
  assert.equal(dueAlerts(spots, drivingNorth, {}).alerts.length, 2);
});

test('spokenPlace reads real ADOT camera names aloud', () => {
  assert.equal(spokenPlace('I-40 @ 158.94'), 'I 40 at milepost 158.94');
  assert.equal(spokenPlace('SR-202 @E of McClintock Dr'), 'Loop 202 at east of McClintock Drive');
  assert.equal(spokenPlace('I-10 @Tunnel EB'), 'I 10 at Tunnel eastbound');
  assert.equal(spokenPlace('SR-87 @Fort McDowell'), 'State Route 87 at Fort McDowell');
  assert.equal(spokenPlace('SR-189 @I-10 SB Ramps'), 'State Route 189 at I 10 southbound Ramps');
  assert.equal(spokenPlace('US-60 @Sossaman Rd'), 'US 60 at Sossaman Road');
});

test('alertText and angleDiff edge cases', () => {
  assert.equal(alertText({ kind: 'speed' }), 'Speed camera ahead.');
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 190), 180);
});

const overpass = JSON.parse(fs.readFileSync(new URL('./fixtures/overpass-az-speed-cameras.json', import.meta.url), 'utf8'));

test('parseSpeedCameras keeps Arizona speed and red-light cameras and drops the mis-tagged Flock reader', () => {
  const cams = parseSpeedCameras(overpass);
  assert.equal(cams.length, 26);
  assert.equal(cams.filter((c) => c.kind === 'redlight').length, 5);
  assert.equal(cams.some((c) => c.id === '8196828915'), false, 'Flock ALPR tagged as a speed camera');
  assert.deepEqual(
    cams.find((c) => c.id === '14180521508'),
    { id: '14180521508', kind: 'redlight', lat: 33.4073188, lon: -111.9261237, maxspeedMph: 46 },
  );
  assert.equal(cams.find((c) => c.id === '3517457644').maxspeedMph, null);
});

test('parseSpeedCameras reads unitless maxspeed as km/h and ignores junk', () => {
  const cams = parseSpeedCameras({
    elements: [
      { type: 'node', id: 1, lat: 33, lon: -112, tags: { highway: 'speed_camera', maxspeed: '64' } },
      { type: 'node', id: 2, lat: 'x', lon: -112, tags: { highway: 'speed_camera' } },
      { type: 'way', id: 3, tags: { highway: 'speed_camera' } },
    ],
  });
  assert.deepEqual(cams, [{ id: '1', kind: 'speed', lat: 33, lon: -112, maxspeedMph: 40 }]);
  assert.deepEqual(parseSpeedCameras(null), []);
});
