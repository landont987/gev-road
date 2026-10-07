// Directions: search a place (or long-press the map), draw the route, keep the
// next turn on screen, and re-route when the truck leaves the line.

import L from 'leaflet';
import {
  ROUTE_URL,
  SEARCH_URL,
  OFF_ROUTE_M,
  OFF_ROUTE_FIXES,
  REROUTE_MIN_GAP_MS,
} from './config.js';
import { parsePlaces } from './parse.js';
import { parseRoute, routeProgress, formatDistance, formatDuration } from './route-logic.js';
import { $, el, openSheet, closeSheet, toast, fetchWithTimeout } from './ui.js';
import { nativeFetch } from './native-fetch.js';

const ROUTE_TIMEOUT_MS = 20000;
const SEARCH_TIMEOUT_MS = 15000;
const POOR_FIX_M = 100; // a fix less accurate than this never triggers a re-route

/** app: { origin() -> {lat, lon, fromGps}, isFollowing(), say(kind, text) } */
export function createRouting(map, app) {
  let route = null;
  let dest = null;
  let line = null;
  let pin = null;
  let offCount = 0;
  let offRouteSpoken = false;
  let routedAt = 0;
  let alongM = null; // where the truck was on the route at the last fix
  let generation = 0; // bumped by every new route request and by END: late answers are dropped
  let searchSeq = 0;

  function clearDrawing() {
    if (line) map.removeLayer(line);
    if (pin) map.removeLayer(pin);
    line = null;
    pin = null;
  }

  function end() {
    generation++;
    route = null;
    dest = null;
    alongM = null;
    clearDrawing();
    $('turnbar').hidden = true;
  }

  function render(p) {
    $('turn-dist').textContent = formatDistance(p.toNextM);
    $('turn-text').textContent = p.next.text;
    $('trip-left').textContent = `${formatDuration(p.remainingS)} · ${formatDistance(p.remainingM)}`;
  }

  function draw(next, target) {
    clearDrawing();
    line = L.polyline(
      next.coords.map((c) => [c[1], c[0]]),
      { color: '#3cc8e6', weight: 7, opacity: 0.9, interactive: false },
    ).addTo(map);
    pin = L.circleMarker([target.lat, target.lon], {
      radius: 10,
      color: '#04212a',
      weight: 3,
      fillColor: '#f2b13c',
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
  }

  async function start(target, quiet) {
    const mine = ++generation;
    // Set before the request, so a failing hotspot is retried every 30 s, not on every fix.
    routedAt = Date.now();
    const from = app.origin();
    if (!quiet && !from.fromGps) toast('No GPS fix yet, so the route starts at the middle of the map.');
    const url = `${ROUTE_URL}${from.lon},${from.lat};${target.lon},${target.lat}?overview=full&geometries=geojson&steps=true`;
    let next;
    try {
      // On the truck this goes through the Android app: the route server only speaks TLS 1.3.
      const res = await nativeFetch(url, ROUTE_TIMEOUT_MS);
      next = parseRoute(await res.json());
    } catch (err) {
      if (mine !== generation) return;
      console.warn('route:', err);
      if (err.noRoute) toast('No road route to that spot. Try a point on a road.');
      else if (quiet) toast('Re-route failed. Still showing the old route.');
      else toast('Could not get directions. Check the hotspot and try again.');
      return;
    }
    if (mine !== generation) return; // ended or replaced while waiting
    route = next;
    dest = target;
    offCount = 0;
    draw(next, target);
    const p = routeProgress(next, from);
    alongM = p.alongM;
    $('turnbar').hidden = false;
    render(p);
    if (!quiet) {
      closeSheet();
      if (!app.isFollowing()) map.fitBounds(line.getBounds(), { padding: [40, 40], animate: false });
    }
  }

  function update(fix) {
    if (!route) return;
    const p = routeProgress(route, fix, alongM);
    alongM = p.alongM;
    if (p.arrived) {
      toast('You have arrived.');
      end();
      return;
    }
    render(p);
    if (fix.accuracy > POOR_FIX_M) return;
    offCount = p.offM > OFF_ROUTE_M ? offCount + 1 : 0;
    if (offCount === 0) offRouteSpoken = false; // back on the line
    if (offCount >= OFF_ROUTE_FIXES && Date.now() - routedAt > REROUTE_MIN_GAP_MS) {
      toast('Off route. Finding a new one...');
      // Said once per time off route; a failed re-route tries again quietly.
      if (!offRouteSpoken) app.say('trip', 'Off route. Finding a new way.');
      offRouteSpoken = true;
      start(dest, true);
    }
  }

  async function search(query, list) {
    const mine = ++searchSeq;
    list.textContent = '';
    list.appendChild(el('div', { class: 'note' }, 'Searching...'));
    const near = app.origin();
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&lat=${near.lat}&lon=${near.lon}&limit=6`;
    try {
      const res = await fetchWithTimeout(url, SEARCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`search HTTP ${res.status}`);
      const places = parsePlaces(await res.json());
      if (mine !== searchSeq) return; // a newer search is showing
      list.textContent = '';
      if (places.length === 0) list.appendChild(el('div', { class: 'note' }, 'Nothing found. Try a different name.'));
      for (const place of places) {
        list.appendChild(
          el('button', { class: 'result', onclick: () => start(place) }, el('b', {}, place.title), el('span', {}, place.detail)),
        );
      }
    } catch (err) {
      if (mine !== searchSeq) return;
      console.warn('search:', err);
      list.textContent = '';
      list.appendChild(el('div', { class: 'note warn' }, 'Search did not work. Check the hotspot and try again.'));
    }
  }

  function openSearch() {
    const body = openSheet('route', 'Where to?');
    const input = el('input', { type: 'search', placeholder: 'Address or place', enterkeyhint: 'search' });
    const list = el('div');
    const go = () => {
      if (input.value.trim()) search(input.value.trim(), list);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    body.appendChild(el('div', { class: 'search-row' }, input, el('button', { class: 'pill small', onclick: go }, 'GO')));
    body.appendChild(list);
    body.appendChild(el('p', { class: 'credits' }, 'Tip: press and hold anywhere on the map to drive there.'));
    if (route) body.appendChild(el('button', { class: 'pill wide', onclick: () => { end(); closeSheet(); } }, 'END CURRENT ROUTE'));
  }

  function confirmPoint(latlng) {
    const body = openSheet('route', 'Drive here?');
    body.appendChild(el('p', { class: 'sheet-sub' }, `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`));
    body.appendChild(el('button', { class: 'pill wide', onclick: () => start({ lat: latlng.lat, lon: latlng.lng }) }, 'DRIVE HERE'));
  }

  $('btn-end-route').addEventListener('click', end);

  return { openSearch, confirmPoint, update, current: () => route };
}
