// Pure geometry helpers. No DOM, no Leaflet, so they run under node:test.

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in meters between two {lat, lon} points. */
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 = north, clockwise) from a to b. */
export function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cumulative distance in meters at each vertex of a [lon, lat] polyline. */
export function cumulativeM(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        distanceM(
          { lon: coords[i - 1][0], lat: coords[i - 1][1] },
          { lon: coords[i][0], lat: coords[i][1] },
        ),
    );
  }
  return cum;
}

/**
 * Snap point p onto a [lon, lat] polyline. Returns how far off the line it is
 * (offM) and how far along the line the snapped point sits (alongM).
 * Uses a local flat projection: accurate to well under a meter at the
 * few-hundred-meter distances an off-route check cares about.
 */
export function projectOntoLine(p, coords, cum) {
  if (coords.length === 0) return { offM: Infinity, alongM: 0 };
  if (coords.length === 1) {
    return { offM: distanceM(p, { lon: coords[0][0], lat: coords[0][1] }), alongM: 0 };
  }
  const kx = Math.cos(toRad(p.lat)) * 111320;
  const ky = 110540;
  let best = { offM: Infinity, alongM: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - p.lon) * kx;
    const ay = (coords[i][1] - p.lat) * ky;
    const dx = (coords[i + 1][0] - p.lon) * kx - ax;
    const dy = (coords[i + 1][1] - p.lat) * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const off = Math.sqrt(cx * cx + cy * cy);
    if (off < best.offM) {
      best = { offM: off, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
  }
  return best;
}

/** Slippy-map tile x/y containing a point at zoom z. */
export function tileFor(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = toRad(lat);
  const y = Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Every tile at zoom z that covers a {south, west, north, east} box. */
export function tilesForBounds(box, z) {
  const nw = tileFor(box.north, box.west, z);
  const se = tileFor(box.south, box.east, z);
  const tiles = [];
  for (let x = nw.x; x <= se.x; x++) {
    for (let y = nw.y; y <= se.y; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/**
 * Finest zoom in [minZ, maxZ] whose tiles for the box number at most maxTiles,
 * or null when even minZ needs more (the caller asks the driver to zoom in).
 */
export function pickTileZoom(box, minZ, maxZ, maxTiles) {
  for (let z = maxZ; z >= minZ; z--) {
    if (tilesForBounds(box, z).length <= maxTiles) return z;
  }
  return null;
}

/** Point a fraction of the way along a [lon, lat] polyline, with its heading. */
export function pointAlong(coords, meters) {
  let left = meters;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lon: coords[i][0], lat: coords[i][1] };
    const b = { lon: coords[i + 1][0], lat: coords[i + 1][1] };
    const seg = distanceM(a, b);
    if (left <= seg || i === coords.length - 2) {
      const t = seg === 0 ? 0 : Math.min(1, left / seg);
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        bearing: bearingDeg(a, b),
        done: left > seg,
      };
    }
    left -= seg;
  }
  const last = coords[coords.length - 1];
  return { lat: last[1], lon: last[0], bearing: 0, done: true };
}
