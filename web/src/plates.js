// License plate reader (ALPR) locations from the DeFlock OpenStreetMap extract.
// Locations and tags only; the tiles are tiny (well under 20 KB each).

import L from 'leaflet';
import { ALPR_TILE_URL, ALPR_MIN_TILE_ZOOM, ALPR_MAX_TILE_ZOOM, ALPR_MAX_TILES, ALPR_TILE_TTL_MS } from './config.js';
import { pickTileZoom, tilesForBounds } from './geo.js';
import { parseAlprTile } from './parse.js';
import { el, openSheet, toast, fetchWithTimeout } from './ui.js';

const MAX_CACHED_TILES = 200;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function facing(deg) {
  if (deg === null) return 'Not recorded';
  return `${COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]} (${Math.round(deg)}°)`;
}

export function createPlates(map, renderer) {
  const group = L.layerGroup();
  const cache = new Map(); // "z/x/y" -> { at, records }
  let enabled = false;
  let drawnKeys = '';
  let request = 0;
  let zoomHintShown = false;
  let errorShown = false;

  function fetchTile(t) {
    const key = `${t.z}/${t.x}/${t.y}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ALPR_TILE_TTL_MS) return Promise.resolve(hit.records);
    const url = ALPR_TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
    return fetchWithTimeout(url, 15000)
      .then((res) => {
        if (res.status === 404) return []; // no cameras mapped in this tile
        if (!res.ok) throw new Error(`plate tile ${key} HTTP ${res.status}`);
        return res.arrayBuffer().then((buf) => parseAlprTile(new Uint8Array(buf), t.z, t.x, t.y));
      })
      .then((records) => {
        cache.delete(key);
        cache.set(key, { at: Date.now(), records });
        while (cache.size > MAX_CACHED_TILES) cache.delete(cache.keys().next().value);
        return records;
      });
  }

  function show(r) {
    const body = openSheet('plate', 'License plate reader');
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Brand'), r.brand || 'Not recorded'));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Operator'), r.operator || 'Not recorded'));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Faces'), facing(r.direction)));
    body.appendChild(
      el('p', { class: 'credits' }, 'Location mapped by OpenStreetMap volunteers (DeFlock). Locations only, not live data.'),
    );
  }

  function draw(lists) {
    group.clearLayers();
    const seen = {};
    for (const records of lists) {
      for (const r of records) {
        if (seen[r.id]) continue;
        seen[r.id] = true;
        L.circleMarker([r.lat, r.lon], {
          renderer,
          radius: 6,
          color: '#2a0006',
          weight: 2,
          fillColor: '#ff4d5e',
          fillOpacity: 1,
        })
          .on('click', () => show(r))
          .addTo(group);
      }
    }
  }

  function refresh() {
    if (!enabled) return;
    const b = map.getBounds();
    const box = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    const z = pickTileZoom(box, ALPR_MIN_TILE_ZOOM, ALPR_MAX_TILE_ZOOM, ALPR_MAX_TILES);
    if (z === null) {
      group.clearLayers();
      drawnKeys = '';
      if (!zoomHintShown) toast('Zoom in to see plate readers.');
      zoomHintShown = true;
      return;
    }
    zoomHintShown = false;
    const tiles = tilesForBounds(box, z);
    const keys = tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(',');
    if (keys === drawnKeys) return; // same area as last time: nothing to redraw
    const mine = ++request;
    let failed = 0;
    Promise.all(
      tiles.map((t) =>
        fetchTile(t).catch((err) => {
          console.warn('plates:', err);
          failed++;
          return [];
        }),
      ),
    ).then((lists) => {
      if (mine !== request || !enabled) return;
      draw(lists);
      drawnKeys = failed ? '' : keys; // retry failed tiles on the next move
      if (failed && !errorShown) toast('Some plate reader spots did not load. Check the hotspot.');
      errorShown = failed > 0;
    });
  }

  map.on('moveend', refresh);

  return {
    setEnabled(on) {
      enabled = on;
      if (on) {
        group.addTo(map);
        drawnKeys = '';
        refresh();
      } else {
        request++;
        map.removeLayer(group);
      }
    },
  };
}
