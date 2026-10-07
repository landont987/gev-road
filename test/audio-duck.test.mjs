import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trackPlayer, duck } from '../web/src/audio-duck.js';

// The parts of an <audio> element audio-duck.js touches.
class FakePlayer extends EventTarget {
  constructor(volume) {
    super();
    this.volume = volume;
    this.src = null;
  }
  getAttribute(name) {
    return name === 'src' ? this.src : null;
  }
  stop() {
    this.src = null; // like removeAttribute('src') + load()
    this.dispatchEvent(new Event('emptied'));
  }
  switchTo(url) {
    this.src = url; // a new src also fires "emptied"
    this.dispatchEvent(new Event('emptied'));
  }
}

test('players are lowered while the voice speaks and restored after', () => {
  const radio = new FakePlayer(0.8);
  trackPlayer(radio);
  radio.switchTo('https://example.com/stream.mp3');
  duck(true);
  assert.equal(radio.volume, 0.25);
  duck(false);
  assert.equal(radio.volume, 0.8);
});

test('a player started during speech starts lowered, and a quiet one is not raised', () => {
  duck(true);
  const late = new FakePlayer(1);
  trackPlayer(late);
  assert.equal(late.volume, 0.25);
  const quiet = new FakePlayer(0.1);
  trackPlayer(quiet);
  assert.equal(quiet.volume, 0.1);
  duck(false);
  assert.equal(late.volume, 1);
  assert.equal(quiet.volume, 0.1);
});

test('a stopped player is forgotten; switching streams keeps it tracked', () => {
  const calls = new FakePlayer(1);
  trackPlayer(calls);
  calls.switchTo('https://example.com/call-2.m4a');
  duck(true);
  assert.equal(calls.volume, 0.25, 'still tracked after a new src');
  duck(false);
  calls.stop();
  calls.volume = 1;
  duck(true);
  assert.equal(calls.volume, 1, 'a stopped player is left alone');
  duck(false);
});
