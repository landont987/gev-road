// Live traffic colors on the roads (TomTom flow tiles). Needs the free key in
// keys.local.json; the app says so when it is missing.

import L from 'leaflet';
import { KEYS, TRAFFIC_URL, TRAFFIC_REFRESH_MS } from './config.js';

export function createTraffic(map) {
  const key = KEYS.tomtom || '';
  let layer = null;
  let timer = null;

  // The time bucket in the URL makes tiles refetch once per refresh period.
  const url = () => `${TRAFFIC_URL}?key=${encodeURIComponent(key)}&t=${Math.floor(Date.now() / TRAFFIC_REFRESH_MS)}`;

  return {
    hasKey: () => !!key,
    setEnabled(on) {
      if (on && key && !layer) {
        layer = L.tileLayer(url(), {
          keepBuffer: 0,
          updateWhenIdle: true,
          maxNativeZoom: 18,
          maxZoom: 19,
          zIndex: 5,
          opacity: 0.9,
          attribution: 'Traffic &copy; TomTom',
        }).addTo(map);
        timer = setInterval(() => layer.setUrl(url()), TRAFFIC_REFRESH_MS);
      } else if (!on && layer) {
        clearInterval(timer);
        map.removeLayer(layer);
        layer = null;
      }
    },
  };
}
