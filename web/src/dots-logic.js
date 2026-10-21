// Which dots to draw: only the ones on screen plus a margin (#47), never
// below a zoom where the map is a city-wide view, and never more than a few
// hundred (#65). The head unit moves every DOM marker in the map pane on each
// GPS recenter, and on the first truck drive it sat at zoom 13 over downtown
// Phoenix with about 1,000 markers: every swipe crawled.
// Boxes are { south, west, north, east } in degrees.

/** Half a screen of margin on every side, so a pan rarely shows an empty edge. */
export const VIEW_PAD = 0.5;
/** Below this zoom (the whole state on screen) the map shows no dots at all. */
export const MIN_DOT_ZOOM = 9;
/**
 * The most dots one layer draws at once, the nearest to the middle of the
 * screen. Three layers can be on (cameras, road info, plate readers), so the
 * page never holds more than about 360 markers; the start view held 1,073.
 */
export const MAX_DOTS = 120;

export function padBox(box, fraction) {
  const dLat = (box.north - box.south) * fraction;
  const dLon = (box.east - box.west) * fraction;
  return {
    south: round(box.south - dLat),
    west: round(box.west - dLon),
    north: round(box.north + dLat),
    east: round(box.east + dLon),
  };
}

function round(deg) {
  return Math.round(deg * 1e9) / 1e9;
}

export function inBox(spot, box) {
  return spot.lat >= box.south && spot.lat <= box.north && spot.lon >= box.west && spot.lon <= box.east;
}

/**
 * The spots to draw: the ones inside the box, and when there are more than
 * max, the max nearest to center ({lat, lon}). Without a center the first max
 * in list order are kept.
 */
export function pickDots(spots, box, center, max) {
  const inside = spots.filter((spot) => inBox(spot, box));
  if (inside.length <= max) return inside;
  if (!center) return inside.slice(0, max);
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const dist2 = (spot) => {
    const dLat = spot.lat - center.lat;
    const dLon = (spot.lon - center.lon) * cosLat;
    return dLat * dLat + dLon * dLon;
  };
  return inside
    .map((spot) => ({ spot, d: dist2(spot) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((entry) => entry.spot);
}

/**
 * spots: every spot; box: the padded screen; drawn: a Set (or Map) of the
 * spots that have a marker now; options: { center, max } (see pickDots).
 * Returns { add, remove }: spots that need a marker and drawn spots that no
 * longer get one.
 */
export function cullDots(spots, box, drawn, options = {}) {
  const wanted = new Set(pickDots(spots, box, options.center || null, options.max || Infinity));
  const add = [];
  const remove = [];
  for (const spot of spots) {
    const keep = wanted.has(spot);
    if (keep && !drawn.has(spot)) add.push(spot);
    else if (!keep && drawn.has(spot)) remove.push(spot);
  }
  return { add, remove };
}
