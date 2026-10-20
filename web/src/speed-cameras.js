// Speed and red-light cameras mapped in OpenStreetMap, for spoken alerts only.
// The app ships with the Arizona list (data/az-speed-cameras.json) because the
// public Overpass server is often busy (504 on 2 of 3 tries, 2026-10-07); a
// fresh list replaces it when the server answers, at most once a day.

import { OVERPASS_URL, SPEED_CAMERAS_QUERY, SPEED_CAMERAS_TTL_MS } from './config.js';
import { parseSpeedCameras } from './parse.js';
import { readCache, writeCache } from './settings.js';
import { nativeFetch } from './native-fetch.js';
import BUNDLED from './data/az-speed-cameras.json';

const CACHE_KEY = 'gev-road-speed-cameras';
const RETRY_MS = 10 * 60 * 1000;
// A busy Overpass queues the query: 33 s on 2026-10-20 (its own limit is 30 s).
const OVERPASS_TIMEOUT_MS = 60000;

export function createSpeedCameras() {
  const cached = readCache(CACHE_KEY, SPEED_CAMERAS_TTL_MS);
  // An expired download is still newer than the bundled list.
  let list = cached || readCache(CACHE_KEY, Infinity) || BUNDLED.cameras;
  // A cache still inside its day counts as loaded now; the next launch after it
  // expires fetches again.
  let loadedAt = cached ? Date.now() : 0;
  let failedAt = 0;
  let loading = false;

  function load() {
    if (loading || Date.now() - loadedAt < SPEED_CAMERAS_TTL_MS || Date.now() - failedAt < RETRY_MS) return;
    loading = true;
    // overpass-api.de only speaks TLS 1.3 (checked 2026-10-20), which Android 9's
    // WebView cannot, so on the truck the Android app fetches it (nativeFetch).
    nativeFetch(`${OVERPASS_URL}?data=${encodeURIComponent(SPEED_CAMERAS_QUERY)}`, OVERPASS_TIMEOUT_MS)
      .then((res) => {
        if (!res.ok) throw new Error(`speed cameras HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const fresh = parseSpeedCameras(json);
        if (!fresh.length) throw new Error('speed cameras: empty answer');
        list = fresh;
        loadedAt = Date.now();
        writeCache(CACHE_KEY, list);
      })
      .catch((err) => {
        failedAt = Date.now();
        console.warn('speed cameras:', err);
      })
      .then(() => {
        loading = false;
      });
  }

  return {
    /** The cameras to check against, loading them in the background when due. */
    spots() {
      load();
      return list;
    },
  };
}
