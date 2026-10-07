// "Everything near me" for the radio sheet:
//  - which county the truck is in (FCC census lookup, cached by position), so
//    the Broadcastify county page with EVERY feed (police, fire, ham repeaters,
//    GMRS, rail, weather) can be opened in the drawer;
//  - internet radio stations in Arizona from Radio Browser, a public-domain
//    directory (PDDL), nearest first. Their streams play straight in the page.
// Both answered browser requests with access-control-allow-origin * on 2026-10-06.

import { COUNTIES } from './radio-feeds.js';
import { distanceM } from './geo.js';
import { readCache, writeCache } from './settings.js';
import { fetchWithTimeout } from './ui.js';

export const COUNTY_URL = 'https://geo.fcc.gov/api/census/area?format=json';
export const STATIONS_URL =
  'https://de1.api.radio-browser.info/json/stations/search?countrycode=US&state=Arizona&hidebroken=true&order=clickcount&reverse=true&limit=200';
const STATIONS_CACHE_KEY = 'gev-road-az-stations';
const STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const M_PER_MILE = 1609.344;

/** The county whose center is closest. Pure; used when the lookup is offline. */
export function nearestCounty(origin) {
  let best = COUNTIES[0];
  let bestM = Infinity;
  for (const county of COUNTIES) {
    const m = distanceM(origin, county);
    if (m < bestM) {
      bestM = m;
      best = county;
    }
  }
  return best;
}

/** Match the FCC answer to a Broadcastify county. Pure. */
export function countyFromFcc(json) {
  const result = json && Array.isArray(json.results) ? json.results[0] : null;
  if (!result || result.state_code !== 'AZ' || typeof result.county_name !== 'string') return null;
  const name = result.county_name.replace(/ County$/, '');
  return COUNTIES.filter((c) => c.name === name)[0] || null;
}

/** Radio Browser rows as the small records the sheet shows, nearest first. Pure. */
export function sortStations(rows, origin) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.name === 'string' && typeof r.url_resolved === 'string' && /^https?:\/\//.test(r.url_resolved))
    .filter((r) => !r.hls) // the page's <audio> plays MP3/AAC, not HLS, on the old WebView
    .map((r) => {
      const hasGeo = Number.isFinite(r.geo_lat) && Number.isFinite(r.geo_long) && (r.geo_lat !== 0 || r.geo_long !== 0);
      return {
        id: String(r.stationuuid || r.url_resolved),
        name: r.name.trim(),
        url: r.url_resolved,
        tags: typeof r.tags === 'string' ? r.tags.split(',').filter(Boolean).slice(0, 3).join(', ') : '',
        codec: [r.codec, r.bitrate ? `${r.bitrate}k` : ''].filter(Boolean).join(' '),
        miles: hasGeo ? distanceM(origin, { lat: r.geo_lat, lon: r.geo_long }) / M_PER_MILE : null,
      };
    })
    .sort((a, b) => (a.miles === null ? 1e9 : a.miles) - (b.miles === null ? 1e9 : b.miles));
}

export function fetchCounty(origin) {
  const url = `${COUNTY_URL}&lat=${origin.lat.toFixed(3)}&lon=${origin.lon.toFixed(3)}`;
  return fetchWithTimeout(url, 10000)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => countyFromFcc(json) || nearestCounty(origin))
    .catch(() => nearestCounty(origin));
}

export function fetchStations() {
  const cached = readCache(STATIONS_CACHE_KEY, STATIONS_TTL_MS);
  if (cached) return Promise.resolve(cached);
  return fetchWithTimeout(STATIONS_URL, 20000)
    .then((res) => {
      if (!res.ok) throw new Error(`stations HTTP ${res.status}`);
      return res.json();
    })
    .then((rows) => {
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('station list came back empty');
      writeCache(STATIONS_CACHE_KEY, rows);
      return rows;
    });
}
