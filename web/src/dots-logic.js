// Which dots to draw: only the ones on screen plus a margin (#47). The head
// unit moves every DOM marker in the map pane on each GPS recenter, and the
// full lists hold about 1,000 dots, so the rest wait until the map gets there.
// Boxes are { south, west, north, east } in degrees.

/** Half a screen of margin on every side, so a pan rarely shows an empty edge. */
export const VIEW_PAD = 0.5;

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
 * spots: every spot; box: the padded screen; drawn: a Set (or Map) of the
 * spots that have a marker now. Returns { add, remove }: spots that need a
 * marker and drawn spots that have left the box.
 */
export function cullDots(spots, box, drawn) {
  const add = [];
  const remove = [];
  for (const spot of spots) {
    const visible = inBox(spot, box);
    if (visible && !drawn.has(spot)) add.push(spot);
    else if (!visible && drawn.has(spot)) remove.push(spot);
  }
  return { add, remove };
}
