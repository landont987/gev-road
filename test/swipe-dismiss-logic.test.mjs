// Swipe-to-dismiss for the road card and toasts: the owner wants to flick a
// notification away instead of waiting for it to time out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swipeResult, isDrag, exitTransform, dragOpacity, SWIPE_DISMISS_PX, SWIPE_TAP_PX } from '../web/src/swipe-dismiss-logic.js';

test('a short drag is not a dismiss (it is a tap)', () => {
  assert.deepEqual(swipeResult(10, 5), { dismiss: false, axis: null, dir: 0 });
  assert.equal(isDrag(5, 4), false);
  assert.equal(isDrag(SWIPE_TAP_PX + 1, 0), true);
});

test('a long horizontal drag dismisses on the x axis in its direction', () => {
  assert.deepEqual(swipeResult(-80, 10), { dismiss: true, axis: 'x', dir: -1 });
  assert.deepEqual(swipeResult(90, -20), { dismiss: true, axis: 'x', dir: 1 });
});

test('a long vertical drag dismisses on the y axis in its direction', () => {
  assert.deepEqual(swipeResult(10, -70), { dismiss: true, axis: 'y', dir: -1 });
  assert.deepEqual(swipeResult(-5, 80), { dismiss: true, axis: 'y', dir: 1 });
});

test('the dominant axis wins when both move', () => {
  assert.equal(swipeResult(100, 60).axis, 'x');
  assert.equal(swipeResult(60, 100).axis, 'y');
});

test('exitTransform flings the element off screen the right way', () => {
  assert.equal(exitTransform('x', -1), 'translateX(-640px)');
  assert.equal(exitTransform('x', 1), 'translateX(640px)');
  assert.equal(exitTransform('y', -1), 'translateY(-360px)');
  assert.equal(exitTransform(null, 0), 'translateY(-360px)');
});

test('drag opacity fades toward 0.2 and never below', () => {
  assert.equal(dragOpacity(0, 0), 1);
  assert.ok(dragOpacity(SWIPE_DISMISS_PX, 0) < 1);
  assert.equal(dragOpacity(10000, 0), 0.2);
});
