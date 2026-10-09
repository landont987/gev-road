import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  parseDetectorLine,
  mergeDetection,
  speakDecision,
  emptySpeechState,
  isRecord,
  statusText,
  tierLabel,
  MAX_RECORDS,
  DETECTION_TEXT,
} from '../web/src/detector-logic.js';

// Lines in the exact formats flock-you's firmware prints (main.cpp on the main
// branch, 2026-09-17: emitDetectionJSON, emitConfigJSON and the [flockyou] notes).
const SERIAL = fs.readFileSync(new URL('./fixtures/flockyou-serial.txt', import.meta.url), 'utf8').split('\n');

test('parseDetectorLine reads only detection lines from a real-format serial log', () => {
  const dets = SERIAL.map(parseDetectorLine).filter(Boolean);
  assert.deepEqual(
    dets.map((d) => `${d.mac} ${d.tier} ${d.rssi}`),
    [
      'b4:1e:52:0a:11:22 4 -82',
      'b4:1e:52:0a:11:22 4 -64',
      'd4:4f:67:30:9a:01 2 -77',
      '70:c9:4e:12:34:56 1 -90',
      '82:6b:f2:00:aa:10 3 -71',
    ],
  );
});

test('parseDetectorLine rejects anything that is not a well-formed detection', () => {
  const ok = { event: 'detection', detection_method: 'wifi_wildcard_probe', mac_address: 'AA:BB:CC:DD:EE:FF', rssi: -50 };
  const line = (o) => JSON.stringify(Object.assign({}, ok, o));
  assert.equal(parseDetectorLine(line({})).mac, 'aa:bb:cc:dd:ee:ff', 'upper-case MAC is fine');
  assert.equal(parseDetectorLine(line({})).tier, 3, 'tier from the method when the line has none');
  assert.equal(parseDetectorLine(line({ detection_tier: 9 })).tier, 3, 'an impossible tier falls back to the method');
  assert.equal(parseDetectorLine(line({ detection_method: 'something_new' })).tier, 0);
  assert.equal(parseDetectorLine(line({ rssi: 20 })).rssi, null);
  assert.equal(parseDetectorLine(line({ event: 'session_det' })), null, 'a session dump is not a live hit');
  assert.equal(parseDetectorLine(line({ mac_address: 'aa:bb:cc' })), null);
  assert.equal(parseDetectorLine(line({ mac_address: '<img src=x>' })), null);
  assert.equal(parseDetectorLine(line({ detection_method: 7 })), null);
  assert.equal(parseDetectorLine('{"event":"detection",'), null, 'cut off mid-line');
  assert.equal(parseDetectorLine('[flockyou] DETECT-OUI mac=aa:bb:cc:dd:ee:ff'), null);
  assert.equal(parseDetectorLine(`{"x":"${'a'.repeat(3000)}"}`), null, 'too long');
  assert.equal(parseDetectorLine(null), null);
  assert.equal(parseDetectorLine('null'), null);
});

const det = (mac, tier, rssi) => ({ mac, tier, rssi });
const fixAt = (lat, lon, at) => ({ lat, lon, at });

test('mergeDetection pins the truck position where the camera was loudest', () => {
  const t = 1000000;
  let m = mergeDetection([], det('aa:aa:aa:aa:aa:01', 3, -85), fixAt(33.6, -112.2, t), t);
  assert.equal(m.changed, true);
  assert.deepEqual([m.record.lat, m.record.lon, m.record.rssi, m.record.count], [33.6, -112.2, -85, 1]);
  m = mergeDetection(m.records, det('aa:aa:aa:aa:aa:01', 3, -60), fixAt(33.61, -112.21, t + 5000), t + 5000);
  assert.deepEqual([m.record.lat, m.record.rssi, m.record.count, m.changed], [33.61, -60, 2, true], 'louder moves the pin');
  m = mergeDetection(m.records, det('aa:aa:aa:aa:aa:01', 3, -75), fixAt(33.62, -112.22, t + 10000), t + 10000);
  assert.deepEqual([m.record.lat, m.record.rssi, m.record.count, m.changed], [33.61, -60, 3, false], 'quieter keeps it');
  m = mergeDetection(m.records, det('aa:aa:aa:aa:aa:01', 4, -80), fixAt(33.63, -112.23, t + 15000), t + 15000);
  assert.deepEqual([m.record.tier, m.record.lat, m.changed], [4, 33.61, true], 'upgrade');
  m = mergeDetection(m.records, det('aa:aa:aa:aa:aa:01', 3, -80), null, t + 20000);
  assert.equal(m.record.tier, 4, 'the best tier sticks');
  assert.equal(m.records.length, 1);
  assert.equal(m.record.firstAt, t);
  assert.ok(isRecord(m.record));
});

test('mergeDetection without a current position stores the hit and pins it at the next fix', () => {
  const t = 2000000;
  let m = mergeDetection([], det('aa:aa:aa:aa:aa:02', 4, -70), fixAt(33.6, -112.2, t - 60000), t);
  assert.equal(m.record.lat, null, 'a minute-old fix does not place a pin');
  m = mergeDetection(m.records, det('aa:aa:aa:aa:aa:02', 4, -90), fixAt(33.7, -112.3, t + 1000), t + 1000);
  assert.deepEqual([m.record.lat, m.record.rssi, m.changed], [33.7, -90, true]);
});

test('mergeDetection keeps the newest first and at most MAX_RECORDS', () => {
  let records = [];
  for (let i = 0; i < MAX_RECORDS + 5; i++) {
    const mac = `aa:aa:aa:aa:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    records = mergeDetection(records, det(mac, 3, -70), fixAt(33, -112, i), i).records;
  }
  assert.equal(records.length, MAX_RECORDS);
  assert.equal(records[0].lastAt, MAX_RECORDS + 4);
});

test('speakDecision: strong hits speak once; parked beside a camera it does not repeat', () => {
  let s = emptySpeechState();
  const say = (d, at, weak) => {
    const r = speakDecision(d, s, at, !!weak);
    s = r.state;
    return r.speak;
  };
  const A = det('aa:aa:aa:aa:aa:0a', 4, -70);
  const t = 10000000;
  assert.equal(say(A, t), true);
  // Heard every 5 seconds for 20 minutes (parked at a light or at home): silent.
  let spoke = 0;
  for (let at = t + 5000; at <= t + 20 * 60000; at += 5000) spoke += say(A, at) ? 1 : 0;
  assert.equal(spoke, 0);
  // Left behind for 6 minutes, then heard again: speaks.
  assert.equal(say(A, t + 26 * 60000), true);
  // Gone 6 minutes again, but spoken only 6 minutes ago: quiet.
  assert.equal(say(A, t + 32 * 60000), false);
});

test('speakDecision: a weak hit pins silently unless weaker hits are on; an upgrade then speaks', () => {
  let s = emptySpeechState();
  const B = det('bb:bb:bb:bb:bb:0b', 2, -80);
  let r = speakDecision(B, s, 1000, false);
  assert.equal(r.speak, false);
  r = speakDecision(Object.assign({}, B, { tier: 4 }), r.state, 6000, false);
  assert.equal(r.speak, true, 'confirmed by the fingerprint seconds later');
  s = emptySpeechState();
  assert.equal(speakDecision(B, s, 1000, true).speak, true, 'weaker hits on');
  assert.equal(speakDecision(det('cc:cc:cc:cc:cc:0c', 1, -80), s, 1000, true).speak, false, 'tier 1 never speaks');
});

test('speakDecision: two cameras at one spot speak once', () => {
  let r = speakDecision(det('aa:00:00:00:00:01', 4, -70), emptySpeechState(), 5000, false);
  assert.equal(r.speak, true);
  r = speakDecision(det('aa:00:00:00:00:02', 4, -72), r.state, 9000, false);
  assert.equal(r.speak, false, 'the second camera 4 s later');
  r = speakDecision(det('aa:00:00:00:00:02', 4, -72), r.state, 70000, false);
  assert.equal(r.speak, false, 'and still not a minute later while it is still heard');
  r = speakDecision(det('aa:00:00:00:00:03', 3, -70), r.state, 130000, false);
  assert.equal(r.speak, true, 'a new camera two minutes on');
});

test('statusText says plainly what the board is doing', () => {
  assert.match(statusText(null), /Android app/);
  assert.match(statusText({ state: 'none', usbHost: true, problem: '' }), /No detector plugged in/);
  assert.match(statusText({ state: 'permission', usbHost: true, problem: '' }), /CONNECT/);
  assert.match(statusText({ state: 'listening', usbHost: true, lines: 12 }), /^Listening\. 12 lines/);
  assert.match(statusText({ state: 'failed', usbHost: true, problem: 'Another app is using the detector.' }), /Another app/);
  assert.match(statusText({ state: 'none', usbHost: false }), /no USB host/);
  assert.match(tierLabel(4), /^High/);
  assert.equal(DETECTION_TEXT, 'Plate reader camera detected.');
});

test('isRecord drops stored junk', () => {
  assert.equal(isRecord({ mac: 'aa:bb:cc:dd:ee:ff', tier: 3, lat: null, lon: null, lastAt: 1, count: 1 }), true);
  assert.equal(isRecord({ mac: 'aa:bb:cc:dd:ee:ff', tier: 3, lat: 'x', lon: 1, lastAt: 1, count: 1 }), false);
  assert.equal(isRecord({ mac: '<b>', tier: 3, lat: null, lastAt: 1, count: 1 }), false);
  assert.equal(isRecord(null), false);
});

test('a method named like an object property gets no tier from it', () => {
  const line = (method) => JSON.stringify({ event: 'detection', detection_method: method, mac_address: 'aa:bb:cc:dd:ee:ff' });
  assert.equal(parseDetectorLine(line('constructor')).tier, 0);
  assert.equal(parseDetectorLine(line('__proto__')).tier, 0);
  assert.equal(parseDetectorLine(line('toString')).tier, 0);
});

test('speech memory stays bounded when a broken board invents thousands of cameras', () => {
  let s = emptySpeechState();
  for (let i = 0; i < 2000; i++) {
    const mac = `aa:aa:aa:aa:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    s = speakDecision(det(mac, 4, -70), s, 1000 + i, false).state;
  }
  assert.ok(Object.keys(s.heardAt).length <= 501, `${Object.keys(s.heardAt).length} remembered`);
  assert.ok(Object.keys(s.spokenAt).length <= 501);
});
