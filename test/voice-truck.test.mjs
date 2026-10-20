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
  pictureTakenAt,
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

test('truckCheckBody sends the truck photo first, then the camera picture, and asks Gemini for JSON only', () => {
  const body = truckCheckBody({
    camera: { base64: 'CAM', mediaType: 'image/jpeg' },
    reference: { base64: 'REF', mediaType: 'image/jpeg' },
    description: 'white 2019 Ford F-150 crew cab',
  });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.maxOutputTokens >= 1024, 'room for short thinking plus the answer');
  const parts = body.contents[0].parts;
  assert.equal(body.contents[0].role, 'user');
  const kinds = parts.map((p) => (p.inline_data ? `image:${p.inline_data.data}:${p.inline_data.mime_type}` : 'text'));
  assert.deepEqual(kinds, ['text', 'image:REF:image/jpeg', 'text', 'image:CAM:image/jpeg', 'text']);
  const ask = parts[4].text;
  assert.match(ask, /white 2019 Ford F-150 crew cab/);
  assert.match(parts[2].text, /^Image 2: the traffic camera picture\.$/);
  assert.match(ask, /box_2d/);
  assert.match(ask, /0-1000/);
  assert.match(ask, /license plates/);
  assert.match(body.system_instruction.parts[0].text, /JSON only/);
});

test('truckCheckBody works with no truck photo', () => {
  const body = truckCheckBody({
    camera: { base64: 'CAM', mediaType: 'image/png' },
    reference: null,
    description: 'black Ram 1500',
  });
  const parts = body.contents[0].parts;
  assert.deepEqual(parts.map((p) => (p.inline_data ? 'image' : 'text')), ['text', 'image', 'text']);
  assert.match(parts[0].text, /^Image 1: the traffic camera picture/);
});

const answer = (text, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
});

test('parseTruckCheck turns Gemini\'s 0-1000 [ymin, xmin, ymax, xmax] box into percent of the picture', () => {
  const r = parseTruckCheck(answer('{"found": true, "confidence": "high", "box_2d": [500, 500, 750, 750], "note": "Right lanes, heading away."}'));
  assert.deepEqual(r, {
    found: true,
    confidence: 'high',
    box: { left: 50, top: 50, width: 25, height: 25 },
    note: 'Right lanes, heading away.',
  });
  const wide = parseTruckCheck(answer('{"found": true, "confidence": "medium", "box_2d": [100, 200, 300, 600], "note": ""}'));
  assert.deepEqual(wide.box, { left: 20, top: 10, width: 40, height: 20 }, 'y first, then x');
});

test('parseTruckCheck finds the JSON inside extra words, skips thinking, and clamps a box off the edge', () => {
  const r = parseTruckCheck({
    candidates: [
      {
        content: {
          parts: [
            { text: '{"found": false}', thought: true },
            { text: 'Here you go:\n```json\n{"found": true, "confidence": "medium", "box_2d": [900, 950, 1100, 1200], "note": "x"}\n```' },
          ],
        },
        finishReason: 'STOP',
      },
    ],
  });
  assert.equal(r.found, true);
  assert.deepEqual(r.box, { left: 95, top: 90, width: 5, height: 10 });
});

test('parseTruckCheck reads a clear "not found" and a low-confidence match', () => {
  assert.deepEqual(parseTruckCheck(answer('{"found": false, "confidence": "high", "box_2d": null, "note": "No pickups."}')), {
    found: false,
    confidence: 'low',
    box: null,
    note: '',
  });
  const noBox = parseTruckCheck(answer('{"found": true, "confidence": "low", "box_2d": null, "note": "maybe"}'));
  assert.deepEqual(noBox, { found: true, confidence: 'low', box: null, note: 'maybe' });
  assert.equal(parseTruckCheck(answer('{"found": true, "confidence": "sure", "box_2d": [1,2]}')).confidence, 'low');
  assert.equal(parseTruckCheck(answer('{"found": true, "confidence": "high", "box_2d": [5, 5, 5, 9]}')).box, null, 'a flat box');
});

test('parseTruckCheck throws when Gemini did not really answer, so it is never shown as "not seen"', () => {
  assert.throws(() => parseTruckCheck(answer('I am not sure.')), /could not be read/);
  assert.throws(() => parseTruckCheck(answer('{"found": "yes"}')), /could not be read/);
  assert.throws(() => parseTruckCheck(answer('{"found": tru')), /could not be read/);
  assert.throws(() => parseTruckCheck({ candidates: [] }), /could not be read/);
  assert.throws(() => parseTruckCheck({ candidates: [{ content: { parts: [{ text: '{"found": false}', thought: true }] } }] }), /could not be read/);
  assert.throws(() => parseTruckCheck(null), /could not be read/);
  assert.throws(() => parseTruckCheck(answer('{"found": false, "note": "cut', 'MAX_TOKENS')), /cut off/);
  assert.throws(() => parseTruckCheck({ candidates: [{ finishReason: 'SAFETY' }] }), /declined/);
  assert.throws(() => parseTruckCheck({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), /declined/);
});

test('base64FromBytes matches Node and survives more than one chunk', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
  assert.equal(base64FromBytes(bytes), Buffer.from(bytes).toString('base64'));
});

// The real answer Gemini gave a made-up key on 2026-10-07.
const BAD_KEY =
  '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com"}]}}';

test('apiErrorText explains the usual Gemini failures plainly', () => {
  assert.match(apiErrorText(400, BAD_KEY), /Google refused the key\. Check "gemini"/);
  assert.match(apiErrorText(403, '{"error":{"code":403,"status":"PERMISSION_DENIED","message":"denied"}}'), /tries again at the next stop/);
  assert.match(
    apiErrorText(403, '{"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"reason":"API_KEY_SERVICE_BLOCKED"}]}}'),
    /AI Studio/,
  );
  assert.match(apiErrorText(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota"}}'), /free limit is used up/);
  assert.equal(apiErrorText(500, 'not json'), 'Gemini answered HTTP 500.');
  assert.equal(apiErrorText(400, '{"error":{"code":400,"message":"Unable to process input image.","status":"INVALID_ARGUMENT"}}'), 'Gemini answered HTTP 400: Unable to process input image..');
});

test('isPermanentApiError stops retries only for errors a retry cannot fix', () => {
  for (const s of [401, 404]) assert.equal(isPermanentApiError(s, ''), true, String(s));
  const bare403 = '{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}';
  assert.equal(isPermanentApiError(403, bare403), false, 'a bare 403 came and went on a new key');
  const off = '{"error":{"code":403,"status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"SERVICE_DISABLED"}]}}';
  assert.equal(isPermanentApiError(403, off), true, 'the API is switched off');
  assert.equal(isPermanentApiError(400, BAD_KEY), true, 'a made-up key');
  const notHere = '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}';
  assert.equal(isPermanentApiError(400, notHere), true, 'Gemini not offered here');
  const badImage = '{"error":{"code":400,"message":"Unable to process input image.","status":"INVALID_ARGUMENT"}}';
  assert.equal(isPermanentApiError(400, badImage), false, 'one bad camera frame');
  for (const s of [413, 429, 500, 502, 503]) assert.equal(isPermanentApiError(s, ''), false, String(s));
});

test('pictureTakenAt reads the cache Age header and treats a missing one as just taken', () => {
  assert.equal(pictureTakenAt(100000, 25), 75000);
  assert.equal(pictureTakenAt(100000, null), 100000);
  assert.equal(pictureTakenAt(100000, 0), 100000);
  assert.equal(pictureTakenAt(100000, 'x'), 100000);
});
