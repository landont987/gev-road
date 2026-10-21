// The menu's SCREEN line (#65): the head unit's pixel ratio, the dots drawn,
// and the frame rate of the last finger drag, so the next truck report has numbers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swipeStats, screenText } from '../web/src/swipe-logic.js';

test('swipeStats: fps from the mean frame time, the worst frame rounded', () => {
  assert.equal(swipeStats([]), null);
  assert.equal(swipeStats([NaN, 0, -3]), null);
  assert.deepEqual(swipeStats([16.7, 16.7, 16.6]), { frames: 3, fps: 60, worstMs: 17 });
  assert.deepEqual(swipeStats([50, 150, 100]), { frames: 3, fps: 10, worstMs: 150 });
});

test('screenText: screen, dots, and the swipe or a hint to make one', () => {
  const screen = { width: 1280, height: 720, ratio: 1 };
  assert.equal(
    screenText(screen, null, 212),
    'Screen 1280x720 at 1.00x. 212 dots drawn. No swipe measured yet: drag the map, then open this menu.',
  );
  assert.equal(
    screenText({ width: 1280, height: 720, ratio: 1.5 }, { frames: 40, fps: 24, worstMs: 85 }, 0),
    'Screen 1280x720 at 1.50x. 0 dots drawn. Last swipe: 24 fps over 40 frames, worst frame 85 ms.',
  );
  assert.match(screenText({ width: 800, height: 480 }, null, 1), /at 1\.00x/);
});
