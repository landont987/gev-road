// Turns raw provider responses into the small records the map draws.
// Pure functions: no DOM, no network.

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

/** ADOT camera rows from the AZGeo FeatureServer JSON. Rows without a picture URL are dropped. */
export function parseAzCameras(json) {
  const features = (json && json.features) || [];
  const cameras = [];
  for (const f of features) {
    const a = f.attributes || {};
    const g = f.geometry || {};
    const lat = Number(g.y);
    const lon = Number(g.x);
    const imageUrl = typeof a.Views === 'string' ? a.Views.trim() : '';
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^https:\/\/az511\.com\/map\/Cctv\/\d+$/.test(imageUrl)) {
      continue;
    }
    cameras.push({
      id: String(a.Id),
      lat,
      lon,
      road: a.Roadway || '',
      direction: a.Direction || '',
      name: a.Location || a.Roadway || 'ADOT camera',
      imageUrl,
    });
  }
  return cameras;
}

/** License plate reader points from one DeFlock vector tile. */
export function parseAlprTile(bytes, z, x, y) {
  const layer = new VectorTile(new PbfReader(bytes)).layers.cameras;
  if (!layer) return [];
  const records = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i).toGeoJSON(x, y, z);
    const p = f.properties || {};
    if (f.geometry.type !== 'Point' || p.osmType !== 'node') continue;
    const [lon, lat] = f.geometry.coordinates;
    records.push({
      id: String(p.osmId),
      lat,
      lon,
      brand: p.brand || '',
      operator: p.operator || '',
      direction: Number.isFinite(p.direction) ? p.direction : null,
    });
  }
  return records;
}

/** Search results from Photon, as short labels. */
export function parsePlaces(json) {
  const features = (json && json.features) || [];
  return features
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => {
      const p = f.properties || {};
      const street = [p.housenumber, p.street].filter(Boolean).join(' ');
      const title = p.name || street || p.city || 'Unnamed place';
      const detail = [p.name ? street : '', p.city, p.state].filter(Boolean).join(', ');
      return { title, detail, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    });
}

/**
 * ADOT camera rows from the keyed AZ511 API (api/v2/get/cameras). Rows look like
 * { Id, Latitude, Longitude, Location, Roadway, Direction, Views: [{ Id, Status, Url }] }
 * (shape taken from the Leeway-Maps iteris511 adapter and its tests; the key page
 * was not readable without an account). Only "Enabled" views with a numeric id are
 * kept; the picture is always fetched from az511.com by that id, never from Url.
 */
export function parseAz511Api(json, imageBase) {
  const rows = Array.isArray(json) ? json : (json && json.cameras) || [];
  const cameras = [];
  for (const row of rows) {
    if (!row) continue;
    const lat = Number(row.Latitude);
    const lon = Number(row.Longitude);
    const views = Array.isArray(row.Views) ? row.Views : [];
    const view = views.filter((v) => v && String(v.Status || '').toLowerCase() === 'enabled' && /^\d+$/.test(String(v.Id)))[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !view) continue;
    cameras.push({
      id: String(view.Id),
      lat,
      lon,
      road: row.Roadway || '',
      direction: row.Direction || '',
      name: row.Location || row.Roadway || 'ADOT camera',
      imageUrl: `${imageBase}${view.Id}`,
    });
  }
  return cameras;
}

const KMH_TO_MPH = 0.621371;

/** "40 mph" -> 40; a bare number is km/h in OpenStreetMap. */
function maxspeedMph(text) {
  const m = /^(\d+)\s*(mph)?$/.exec(String(text || '').trim());
  if (!m) return null;
  return m[2] ? Number(m[1]) : Math.round(Number(m[1]) * KMH_TO_MPH);
}

/**
 * Speed and red-light cameras from an Overpass answer for node["highway"="speed_camera"].
 * Flock plate readers mis-tagged as speed cameras are dropped: DeFlock already shows them.
 */
export function parseSpeedCameras(json) {
  const elements = (json && json.elements) || [];
  const cameras = [];
  for (const e of elements) {
    const t = (e && e.tags) || {};
    const lat = Number(e && e.lat);
    const lon = Number(e && e.lon);
    if (e.type !== 'node' || t.highway !== 'speed_camera' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (t['surveillance:type'] === 'ALPR') continue;
    const redlight = t.surveillance === 'red_light' || /red light/i.test(t.description || '');
    cameras.push({ id: String(e.id), kind: redlight ? 'redlight' : 'speed', lat, lon, maxspeedMph: maxspeedMph(t.maxspeed) });
  }
  return cameras;
}
