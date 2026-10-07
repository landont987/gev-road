// Which spoken alerts are due as the truck moves, and what they say.
// Pure: no DOM, no timers, no network.

import { distanceM, bearingDeg } from './geo.js';

// How close each kind of spot is when its alert is spoken. ADOT cameras turn,
// so "in view" counts from any side; the others are warned about only ahead.
const RULES = {
  plate: { withinM: 400, aheadOnly: true },
  speed: { withinM: 400, aheadOnly: true },
  redlight: { withinM: 300, aheadOnly: true },
  camera: { withinM: 300, aheadOnly: false },
};
const AHEAD_CONE_DEG = 40;
const HEADING_MIN_SPEED_MPS = 1; // below this the GPS heading is noise
const NO_HEADING_M = 120; // without a heading, only a spot this close counts as ahead
const REARM_M = 1000; // a spot speaks again only after the truck has been this far from it
const MAX_PER_FIX = 2;

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function isAhead(fix, spot, d) {
  const hasHeading = fix.bearing !== null && fix.speed !== null && fix.speed >= HEADING_MIN_SPEED_MPS;
  if (!hasHeading) return d <= NO_HEADING_M;
  return angleDiff(bearingDeg(fix, spot), fix.bearing) <= AHEAD_CONE_DEG;
}

const ROAD_WORDS = { Rd: 'Road', St: 'Street', Ave: 'Avenue', Dr: 'Drive', Blvd: 'Boulevard', Pkwy: 'Parkway', Hwy: 'Highway' };
const SIDES = { E: 'east', W: 'west', N: 'north', S: 'south' };
const BOUND = { EB: 'eastbound', WB: 'westbound', NB: 'northbound', SB: 'southbound' };
const LOOPS = { 101: true, 202: true, 303: true };

/** "SR-202 @E of McClintock Dr" -> "Loop 202 at east of McClintock Drive", for the voice. */
export function spokenPlace(name) {
  return String(name || '')
    .replace(/\bSR-(\d+)/g, (m, n) => (LOOPS[n] ? `Loop ${n}` : `State Route ${n}`))
    .replace(/\b(I|US)-(\d+)/g, '$1 $2')
    .replace(/@\s*(\d+(?:\.\d+)?)\b/g, 'at milepost $1')
    .replace(/@\s*/g, 'at ')
    .replace(/\b([EWNS]) of\b/g, (m, side) => `${SIDES[side]} of`)
    .replace(/\b(EB|WB|NB|SB)\b/g, (m, b) => BOUND[b])
    .replace(/\b(Rd|St|Ave|Dr|Blvd|Pkwy|Hwy)\b\.?/g, (m, w) => ROAD_WORDS[w])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ADOT gives one name to several cameras along a stretch, per direction
 * ("I-10 @Tunnel WB" x3, "I-10 @Tunnel EB" x4), so a camera alert is per place:
 * the name without its direction.
 */
export function cameraPlace(name) {
  return String(name || '')
    .replace(/\s+(EB|WB|NB|SB)\b/g, '')
    .trim();
}

export function alertText(spot) {
  if (spot.kind === 'plate') return 'Plate reader ahead.';
  if (spot.kind === 'redlight') return 'Red light camera ahead.';
  if (spot.kind === 'speed') {
    return spot.maxspeedMph ? `Speed camera ahead, ${spot.maxspeedMph} miles per hour.` : 'Speed camera ahead.';
  }
  return `You're in view of the ${spokenPlace(spot.place || spot.name)} camera.`;
}

/** Nearest spot per alert key: a place (cameras) or kind + id; duplicates collapse. */
function nearestPerKey(spots, fix) {
  const nearest = {};
  for (const spot of spots) {
    if (!RULES[spot.kind]) continue;
    const key = `${spot.kind}:${spot.place || spot.id}`;
    const d = distanceM(fix, spot);
    if (!nearest[key] || d < nearest[key].d) nearest[key] = { key, spot, d };
  }
  return nearest;
}

/**
 * spots: [{ id, kind, lat, lon, name?, place?, maxspeedMph? }]; spots sharing a
 * place speak as one.
 * fix: { lat, lon, bearing|null, speed|null }
 * spoken: { "kind:place-or-id": true } from the last call (start with {}).
 * Returns the alerts to say now (nearest first, at most two) and the next `spoken`.
 */
export function dueAlerts(spots, fix, spoken) {
  const nextSpoken = Object.assign({}, spoken);
  const due = [];
  const nearest = nearestPerKey(spots, fix);
  for (const key of Object.keys(nearest)) {
    const { spot, d } = nearest[key];
    const rule = RULES[spot.kind];
    if (nextSpoken[key]) {
      if (d > REARM_M) delete nextSpoken[key];
      continue;
    }
    if (d > rule.withinM) continue;
    if (rule.aheadOnly && !isAhead(fix, spot, d)) continue;
    due.push({ key, spot, d });
  }
  due.sort((a, b) => a.d - b.d);
  const now = due.slice(0, MAX_PER_FIX);
  for (const a of now) nextSpoken[a.key] = true;
  return {
    alerts: now.map((a) => ({ key: a.key, kind: a.spot.kind, text: alertText(a.spot) })),
    spoken: nextSpoken,
  };
}
