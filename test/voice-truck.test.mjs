import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { VOICES, ACCENTS, instructionsFor, speechBody } from '../web/src/voice-options.js';
import {
  imageSize,
  isOfflineCard,
  bytesFromBase64,
  truckCheckBody,
  parseTruckCheck,
  base64FromBytes,
  apiErrorText,
  isPermanentApiError,
} from '../web/src/truck-check-logic.js';

const fixture = (name) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('there are 13 OpenAI voices and every accent has a label and a spoken form', () => {
  assert.equal(VOICES.length, 13);
  assert.ok(VOICES.includes('cedar') && VOICES.includes('marin'));
  assert.ok(ACCENTS.length >= 25);
  for (const a of ACCENTS) assert.ok(a.id && a.label && a.say, JSON.stringify(a));
  assert.equal(new Set(ACCENTS.map((a) => a.id)).size, ACCENTS.length, 'accent ids are unique');
});

test('instructionsFor asks for a natural, respectful accent', () => {
  const arabic = instructionsFor('arabic-gulf');
  assert.match(arabic, /^Speak English with a natural Gulf Arabic accent\./);
  assert.match(arabic, /never exaggerated/);
  assert.match(instructionsFor('american'), /^Speak clear American English\./);
  assert.equal(instructionsFor('no-such-accent'), instructionsFor('american'));
});

test('speechBody is the OpenAI speech request', () => {
  const body = JSON.parse(speechBody('Plate reader ahead.', 'cedar', 'mandarin'));
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'response_format', 'voice']);
  assert.equal(body.model, 'gpt-4o-mini-tts');
  assert.equal(body.voice, 'cedar');
  assert.equal(body.input, 'Plate reader ahead.');
  assert.equal(body.response_format, 'mp3');
  assert.match(body.instructions, /Mandarin Chinese accent/);
  assert.equal(JSON.parse(speechBody('x', 'nope', 'american')).voice, VOICES[0], 'unknown voice falls back');
});

test('imageSize reads a real ADOT JPEG and the real offline PNG card', () => {
  assert.deepEqual(imageSize(fixture('adot-960-head.jpg')), { type: 'jpeg', width: 1280, height: 720 });
  const offline = imageSize(fixture('adot-offline-head.png'));
  assert.deepEqual(offline, { type: 'png', width: 540, height: 330 });
  assert.equal(isOfflineCard(offline), true);
  assert.equal(isOfflineCard({ type: 'jpeg', width: 1280, height: 720 }), false);
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});

test('bytesFromBase64 round-trips binary', () => {
  assert.deepEqual(Array.from(bytesFromBase64('AP+AAQ==')), [0, 255, 128, 1]);
});

test('truckCheckBody sends the truck photo first, then the camera picture, and asks for JSON only', () => {
  const body = truckCheckBody({
    model: 'claude-opus-5-5',
    camera: { base64: 'CAM', mediaType: 'image/jpeg', width: 1280, height: 720 },
    reference: { base64: 'REF', mediaType: 'image/jpeg' },
    description: 'white 2019 Ford F-150 crew cab',
  });
  assert.equal(body.model, 'claude-opus-5-5');
  assert.ok(body.max_tokens > 0 && body.max_tokens <= 500);
  const content = body.messages[0].content;
  const kinds = content.map((c) => (c.type === 'image' ? `image:${c.source.data}` : 'text'));
  assert.deepEqual(kinds, ['text', 'image:REF', 'text', 'image:CAM', 'text']);
  const ask = content[4].text;
  assert.match(ask, /white 2019 Ford F-150 crew cab/);
  assert.match(content[2].text, /^Image 2: the traffic camera picture, 1280 x 720 pixels\.$/);
  assert.match(ask, /license plates/);
  assert.match(body.system, /JSON only/);
});

test('truckCheckBody works with no truck photo', () => {
  const body = truckCheckBody({
    model: 'm',
    camera: { base64: 'CAM', mediaType: 'image/jpeg', width: 1920, height: 1080 },
    reference: null,
    description: 'black Ram 1500',
  });
  assert.deepEqual(body.messages[0].content.map((c) => c.type), ['text', 'image', 'text']);
});

const answer = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

test('parseTruckCheck turns the model answer into a box in percent of the picture', () => {
  const r = parseTruckCheck(
    answer('{"found": true, "confidence": "high", "box": [640, 360, 960, 540], "note": "Right lanes, heading away."}'),
    { width: 1280, height: 720 },
  );
  assert.deepEqual(r, {
    found: true,
    confidence: 'high',
    box: { left: 50, top: 50, width: 25, height: 25 },
    note: 'Right lanes, heading away.',
  });
});

test('parseTruckCheck finds the JSON inside extra words and clamps a box off the edge', () => {
  const r = parseTruckCheck(
    answer('Here you go:\n```json\n{"found": true, "confidence": "medium", "box": [1200, 700, 1400, 800], "note": "x"}\n```'),
    { width: 1280, height: 720 },
  );
  assert.equal(r.found, true);
  assert.deepEqual(r.box, { left: 93.75, top: 97.22, width: 6.25, height: 2.78 });
});

test('parseTruckCheck reads a clear "not found" and a low-confidence match', () => {
  const size = { width: 1280, height: 720 };
  assert.deepEqual(parseTruckCheck(answer('{"found": false, "confidence": "high", "box": null, "note": "No pickups."}'), size), {
    found: false,
    confidence: 'low',
    box: null,
    note: '',
  });
  const noBox = parseTruckCheck(answer('{"found": true, "confidence": "low", "box": null, "note": "maybe"}'), size);
  assert.deepEqual(noBox, { found: true, confidence: 'low', box: null, note: 'maybe' });
  assert.equal(parseTruckCheck(answer('{"found": true, "confidence": "sure", "box": [1,2]}'), size).confidence, 'low');
});

test('parseTruckCheck throws when the AI did not really answer, so it is never shown as "not seen"', () => {
  const size = { width: 1280, height: 720 };
  assert.throws(() => parseTruckCheck(answer('I am not sure.'), size), /could not be read/);
  assert.throws(() => parseTruckCheck(answer('{"found": "yes"}'), size), /could not be read/);
  assert.throws(() => parseTruckCheck(answer('{"found": tru'), size), /could not be read/);
  assert.throws(() => parseTruckCheck({ content: [] }, size), /could not be read/);
  assert.throws(() => parseTruckCheck(null, size), /could not be read/);
  assert.throws(
    () => parseTruckCheck({ content: [{ type: 'text', text: '{"found": false, "note": "cut' }], stop_reason: 'max_tokens' }, size),
    /cut off/,
  );
  assert.throws(() => parseTruckCheck({ content: [], stop_reason: 'refusal' }, size), /declined/);
});

test('base64FromBytes matches Node and survives more than one chunk', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  assert.equal(base64FromBytes(bytes), Buffer.from(bytes).toString('base64'));
});

test('apiErrorText explains the usual Anthropic failures plainly', () => {
  assert.match(apiErrorText(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), /refused the key/);
  assert.match(
    apiErrorText(400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'),
    /out of credit/,
  );
  assert.match(apiErrorText(429, ''), /too many checks/);
  assert.equal(apiErrorText(500, 'not json'), 'Anthropic answered HTTP 500.');
});

test('isPermanentApiError stops retries only for errors a retry cannot fix', () => {
  for (const s of [400, 401, 403, 404, 413]) assert.equal(isPermanentApiError(s), true, String(s));
  for (const s of [429, 500, 502, 529]) assert.equal(isPermanentApiError(s), false, String(s));
});
