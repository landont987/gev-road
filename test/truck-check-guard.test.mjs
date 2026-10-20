// The AI truck check must not announce a different vehicle. On 2026-10-20
// Gemini said "found, high confidence: a red Toyota Tundra" five times out of
// five for a white dump truck (SR-87 @Hunt Highway). The answer now names the
// vehicle it picked (color and body), and the app turns a "found" whose color
// or body cannot be the driver's truck into "not seen".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truckCheckBody, parseTruckCheck } from '../web/src/truck-check-logic.js';

const DESCRIPTION = 'red 2014 Toyota Tundra crew cab pickup with black wheels';
const answer = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });
const found = (candidate) => answer({ candidate, found: true, confidence: 'high', box_2d: [363, 76, 420, 112], note: 'Upper left.' });

test('the request asks Gemini to name the color and body of the vehicle it picked, and warns about semis and other colors', () => {
  const body = truckCheckBody({ camera: { base64: 'C', mediaType: 'image/jpeg' }, reference: null, description: DESCRIPTION });
  const ask = body.contents[0].parts[2].text;
  assert.match(ask, /"candidate"/);
  assert.match(ask, /color/);
  assert.match(ask, /semi/i);
  assert.match(ask, /when in doubt/i);
});

test('a "found" for a white dump truck is not seen (wrong color, wrong body)', () => {
  const r = parseTruckCheck(found({ color: 'white', body: 'dump truck' }), DESCRIPTION);
  assert.equal(r.found, false);
});

test('a "found" for a red semi is not seen (a semi is never a pickup)', () => {
  assert.equal(parseTruckCheck(found({ color: 'red', body: 'semi truck' }), DESCRIPTION).found, false);
});

test('a "found" for a silver pickup is not seen (no color in common)', () => {
  assert.equal(parseTruckCheck(found({ color: 'silver', body: 'pickup' }), DESCRIPTION).found, false);
});

test('a red pickup stays found', () => {
  const r = parseTruckCheck(found({ color: 'dark red', body: 'pickup truck' }), DESCRIPTION);
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'high');
});

test('a "found" without a named vehicle is not trusted', () => {
  assert.equal(parseTruckCheck(answer({ found: true, confidence: 'high', box_2d: null, note: '' }), DESCRIPTION).found, false);
});

test('with no description to compare against, the answer stands', () => {
  assert.equal(parseTruckCheck(found({ color: 'white', body: 'pickup' }), '').found, true);
});

// ---- the neutral first look: which vehicles are in the picture ----
import { vehicleListBody, parseVehicleList, plausibleVehicles, confirmMatch } from '../web/src/truck-check-logic.js';

const listAnswer = (text) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

test('the first look sends only the camera picture and never describes the driver\'s truck', () => {
  const body = vehicleListBody({ camera: { base64: 'CAM', mediaType: 'image/jpeg' } });
  const parts = body.contents[0].parts;
  assert.deepEqual(parts.map((p) => (p.inline_data ? `image:${p.inline_data.data}` : 'text')), ['image:CAM', 'text']);
  assert.doesNotMatch(JSON.stringify(body), /driver/i);
  assert.match(parts[1].text, /"vehicles"/);
  assert.match(parts[1].text, /license plates/);
});

test('the vehicle list is read from an object, a bare array, or not at all', () => {
  const a = parseVehicleList(listAnswer('{"vehicles": [{"color": "white", "body": "semi truck", "box_2d": [363, 76, 407, 110]}]}'));
  assert.equal(a.length, 1);
  assert.equal(a[0].color, 'white');
  assert.deepEqual(a[0].box, { left: 7.6, top: 36.3, width: 3.4, height: 4.4 });
  const b = parseVehicleList(listAnswer('[{"color": "red", "body": "pickup", "box_2d": [100, 100, 200, 200]}]'));
  assert.equal(b[0].body, 'pickup');
  assert.deepEqual(parseVehicleList(listAnswer('{"vehicles": []}')), []);
  // A dropped brace (seen live): the whole vehicles still count.
  const broken = parseVehicleList(listAnswer('{"vehicles": [{"color": "white", "body": "semi truck", "box_2d": [371, 79, 411, 112]}, "color": "white", "body": "semi truck", "box_2d": [363, 970, 383, 980]}]}'));
  assert.deepEqual(broken.map((v) => v.body), ['semi truck']);
  assert.throws(() => parseVehicleList(listAnswer('no json here')), /could not be read/);
});

test('only vehicles that could be the truck go on to the comparison', () => {
  const seen = [
    { color: 'white', body: 'semi truck', box: null },
    { color: 'red', body: 'pickup', box: { left: 10, top: 10, width: 5, height: 5 } },
    { color: 'silver', body: 'pickup', box: null },
    { color: 'black', body: 'car', box: null },
  ];
  assert.deepEqual(plausibleVehicles(seen, DESCRIPTION).map((v) => v.color), ['red']);
  assert.equal(plausibleVehicles(seen, '').length, 4, 'no description: every vehicle');
});

test('a match must point at one of those vehicles', () => {
  const maybe = [{ color: 'red', body: 'pickup', box: { left: 10, top: 10, width: 5, height: 5 } }];
  const at = (left, top) => ({ found: true, confidence: 'high', box: { left, top, width: 4, height: 4 }, note: '' });
  assert.equal(confirmMatch(at(11, 11), maybe).found, true);
  assert.equal(confirmMatch(at(60, 60), maybe).found, false, 'boxed somewhere else');
  const noBox = confirmMatch({ found: true, confidence: 'high', box: null, note: '' }, maybe);
  assert.equal(noBox.found, true);
  assert.equal(noBox.confidence, 'low', 'no box to check: shown, never spoken');
  assert.equal(confirmMatch({ found: false, confidence: 'high', box: null, note: '' }, maybe).found, false);
});
