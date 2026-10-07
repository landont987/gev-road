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
