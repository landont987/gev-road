// Pure helpers for a GPS fix, tested under node.

import { distanceM } from './geo.js';

const MIN_GAP_S = 0.5; // two fixes closer than this say nothing useful about speed
const MAX_GAP_S = 5; // after a GPS dropout the distance covered is not a speed

/**
 * Some GPS units report no speed. Then speed comes from the last two fixes,
 * so "stopped" (truck check, parked-only setup) is never assumed while
 * driving. A gap too short to measure keeps the previous speed (#57); a gap
 * after a dropout leaves it unknown.
 */
export function withSpeed(fix, prev, prevAt, nowMs) {
  if (fix.speed !== null || !prev) return fix;
  // Two providers (gps, network) can sit a kilometre apart: the jump between them is not a speed.
  if ((fix.provider || '') !== (prev.provider || '')) return fix;
  const seconds = (nowMs - prevAt) / 1000;
  if (seconds < MIN_GAP_S) {
    // Carry a measured speed once, never a carried one: a unit sending fixes faster
    // than twice a second must still get its speed recomputed.
    if (prev.speed === null || prev.speedCarried) return fix;
    return Object.assign({}, fix, { speed: prev.speed, speedCarried: true });
  }
  if (seconds > MAX_GAP_S) return fix;
  return Object.assign({}, fix, { speed: distanceM(prev, fix) / seconds });
}
