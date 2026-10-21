// Where the truck is. Two sources:
//  - "truck": the Android app pushes real GPS fixes into window.gevOnLocation.
//  - "demo":  a fake drive along a real Phoenix route, for the mockup and for
//             testing in the emulator.

import { pointAlong } from './geo.js';
import { parseRoute } from './route-logic.js';
import { ROUTE_URL } from './config.js';
import { nativeFetch } from './native-fetch.js';

const DEMO_START = { lat: 33.4455, lon: -112.0667 }; // Chase Field
const DEMO_END = { lat: 33.672, lon: -112.116 }; // I-17 at Deer Valley
const DEMO_SPEEDUP = 2; // the screen moves 2x faster than the speed shown
const FIX_EVERY_MS = 1000;

/** hooks: { onStatus(status), onLastKnown({lat, lon, ageS}) }, both optional. */
export function createGps(onFix, hooks = {}) {
  let source = window.GevNative ? 'truck' : 'demo';
  let demoTimer = null;
  let demoRoute = null; // the route being driven
  let stockRoute = null; // the I-17 trip, fetched once
  let demoAlong = 0;
  let demoDriving = false;
  let status = null; // the app's GPS state (GpsWatch.statusJson), null on a computer

  window.gevOnLocation = (lat, lon, speed, bearing, accuracy, provider) => {
    if (source !== 'truck') return;
    onFix({
      lat,
      lon,
      speed: speed >= 0 ? speed : null,
      bearing: bearing >= 0 ? bearing : null,
      accuracy,
      provider: provider || '',
      source: 'truck',
    });
  };

  let lastKnownShown = false;

  // Where the truck was last seen (up to hours ago): the start view, not a live fix.
  function showLastKnown(lat, lon, ageS) {
    if (source !== 'truck' || !hooks.onLastKnown || lastKnownShown) return;
    lastKnownShown = true;
    hooks.onLastKnown({ lat, lon, ageS: Number(ageS) || 0 });
  }

  function applyStatus(json) {
    try {
      status = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (err) {
      console.warn('gps status:', err);
      return false;
    }
    // The app's first pushes land before this page exists, so the state also carries the parked spot.
    if (status && status.lastKnown) showLastKnown(status.lastKnown.lat, status.lastKnown.lon, status.lastKnown.ageS);
    return true;
  }

  // Why there is no fix: the location setting, the permission, the satellites (#64).
  window.gevOnGpsStatus = (json) => {
    if (applyStatus(json) && hooks.onStatus) hooks.onStatus(status);
  };

  window.gevOnLastKnown = showLastKnown;

  /** The app's GPS state, read fresh (a bridge call: at start and when the menu opens), else the last pushed one. */
  function readStatus() {
    if (window.GevNative && typeof window.GevNative.gpsStatusJson === 'function') {
      try {
        applyStatus(window.GevNative.gpsStatusJson());
      } catch (err) {
        console.warn('gps status:', err);
      }
    }
    return status;
  }

  function demoTick() {
    if (!demoRoute) {
      onFix({ lat: DEMO_START.lat, lon: DEMO_START.lon, speed: 0, bearing: 0, accuracy: 5, source: 'demo' });
      return;
    }
    const speed = demoRoute.distanceM / demoRoute.durationS;
    if (demoDriving) demoAlong += (speed * DEMO_SPEEDUP * FIX_EVERY_MS) / 1000;
    const p = pointAlong(demoRoute.coords, demoAlong);
    if (p.done) demoDriving = false;
    onFix({
      lat: p.lat,
      lon: p.lon,
      speed: demoDriving ? speed : 0,
      bearing: p.bearing,
      accuracy: 5,
      source: 'demo',
    });
  }

  function startDemoTimer() {
    clearInterval(demoTimer);
    demoTimer = setInterval(demoTick, FIX_EVERY_MS);
    demoTick();
  }

  /** Drive the given route (the one on screen), or the stock I-17 trip when there is none. */
  async function demoDrive(route) {
    if (!route && !stockRoute) {
      const url = `${ROUTE_URL}${DEMO_START.lon},${DEMO_START.lat};${DEMO_END.lon},${DEMO_END.lat}?overview=full&geometries=geojson&steps=true`;
      const res = await nativeFetch(url, 20000); // the route server needs TLS 1.3 (see routing.js)
      stockRoute = parseRoute(await res.json());
    }
    const next = route || stockRoute;
    if (next !== demoRoute || pointAlong(next.coords, demoAlong).done) demoAlong = 0;
    demoRoute = next;
    source = 'demo';
    demoDriving = true;
    startDemoTimer();
  }

  function demoPark() {
    source = 'demo';
    demoDriving = false;
    startDemoTimer();
  }

  function demoRestart() {
    demoAlong = 0;
    demoDriving = false;
  }

  function useTruck() {
    source = 'truck';
    demoDriving = false;
    clearInterval(demoTimer);
  }

  if (source === 'demo') startDemoTimer();

  return {
    source: () => source,
    hasTruckGps: () => !!window.GevNative,
    isDebug: () => !!(window.GevNative && typeof window.GevNative.isDebug === 'function' && window.GevNative.isDebug()),
    status: () => status,
    readStatus,
    demoDrive,
    demoPark,
    demoRestart,
    useTruck,
  };
}
