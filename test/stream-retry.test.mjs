// A streamed station or scanner comes back by itself after the stream ends or
// stalls (#56): a hotspot reset usually ends a live stream with "ended" or
// "stalled", not "error", and the driver must not have to press play again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchStream } from '../web/src/stream-retry.js';

function fakeAudio() {
  const a = { handlers: {}, addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); } };
  a.emit = (type) => (a.handlers[type] || []).forEach((fn) => fn());
  return a;
}

test('error and ended both restart the stream after the retry delay, once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = fakeAudio();
  let restarts = 0;
  watchStream(audio, { retryMs: 4000, stallMs: 15000, isCurrent: () => true, restart: () => restarts++ });
  audio.emit('error');
  audio.emit('ended'); // a second signal while a retry waits does not double it
  t.mock.timers.tick(3999);
  assert.equal(restarts, 0);
  t.mock.timers.tick(1);
  assert.equal(restarts, 1);
  audio.emit('ended');
  t.mock.timers.tick(4000);
  assert.equal(restarts, 2, 'ended alone restarts too');
});

test('a stall restarts only after the grace period with no progress', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = fakeAudio();
  let restarts = 0;
  watchStream(audio, { retryMs: 4000, stallMs: 15000, isCurrent: () => true, restart: () => restarts++ });
  audio.emit('stalled');
  t.mock.timers.tick(10000);
  audio.emit('progress'); // data came: a slow hotspot, not a dead stream
  t.mock.timers.tick(10000);
  assert.equal(restarts, 0, 'progress cancelled the stall');
  audio.emit('stalled');
  t.mock.timers.tick(15000);
  assert.equal(restarts, 1, 'no data for 15 s: restarted');
});

test('nothing restarts once the driver stopped or switched', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = fakeAudio();
  let restarts = 0;
  let current = true;
  watchStream(audio, { retryMs: 4000, stallMs: 15000, isCurrent: () => current, restart: () => restarts++ });
  audio.emit('ended');
  current = false;
  t.mock.timers.tick(4000);
  assert.equal(restarts, 0);
});
