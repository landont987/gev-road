// Map dots (cameras, plate readers, road info, heard readers) as small DOM
// markers: a 40px invisible tap box around a visible dot, sized for a finger
// on a 7-inch screen. Not L.canvas: the Android 9 test WebView (Chrome 66)
// never puts large, GPU-backed canvases on screen, so canvas dots were drawn
// but invisible.
//
// createDotLayer keeps the DOM small: only the dots on screen plus a margin
// are markers, at most MAX_DOTS and none below MIN_DOT_ZOOM (dots-logic.js),
// re-checked when the map stops moving.

import L from 'leaflet';
import { VIEW_PAD, MIN_DOT_ZOOM, MAX_DOTS, padBox, cullDots } from './dots-logic.js';

const TAP_BOX_PX = 40;
const icons = {};

/** kind is 'camera', 'plate', ...; the look lives in style.css (.dot-camera, .dot-plate). */
export function dot(lat, lon, kind, onTap) {
  if (!icons[kind]) {
    icons[kind] = L.divIcon({
      className: `dot dot-${kind}`,
      iconSize: [TAP_BOX_PX, TAP_BOX_PX],
      iconAnchor: [TAP_BOX_PX / 2, TAP_BOX_PX / 2],
    });
  }
  return L.marker([lat, lon], { icon: icons[kind], keyboard: false }).on('click', onTap);
}

/**
 * A layer of dots that draws only what is near the screen.
 * Spots are { lat, lon, kind, onTap }; the same objects must be passed again
 * for the layer to know which markers it already has.
 */
export function createDotLayer(map) {
  const group = L.layerGroup();
  const drawn = new Map(); // spot -> marker
  let spots = [];
  let enabled = false;

  function viewBox() {
    const b = map.getBounds();
    return padBox({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, VIEW_PAD);
  }

  function clear() {
    group.clearLayers();
    drawn.clear();
  }

  function refresh() {
    if (!enabled) return;
    if (map.getZoom() < MIN_DOT_ZOOM) {
      clear();
      return;
    }
    const c = map.getCenter();
    const { add, remove } = cullDots(spots, viewBox(), drawn, { center: { lat: c.lat, lon: c.lng }, max: MAX_DOTS });
    for (const spot of remove) {
      group.removeLayer(drawn.get(spot));
      drawn.delete(spot);
    }
    for (const spot of add) {
      drawn.set(spot, dot(spot.lat, spot.lon, spot.kind, spot.onTap).addTo(group));
    }
  }

  map.on('moveend', refresh);

  return {
    /** A new list: every old marker goes, and the ones near the screen are drawn. */
    setSpots(list) {
      spots = list;
      clear();
      refresh();
    },
    setEnabled(on) {
      enabled = on;
      if (on) {
        group.addTo(map);
        refresh();
      } else {
        map.removeLayer(group);
        clear();
      }
    },
    refresh,
    /** How many dots are DOM markers right now. */
    count: () => drawn.size,
  };
}
