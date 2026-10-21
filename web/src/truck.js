// The truck arrow and "follow my truck". A finger drag stops following; while
// moving, the map follows again by itself after 10 s with no touch (#53), so
// a stray touch never leaves the map frozen until RECENTER is tapped.

import L from 'leaflet';
import { MOVING_SPEED_MPS } from './config.js';

const ARROW_SVG =
  '<svg width="44" height="44" viewBox="0 0 44 44">' +
  '<g transform="rotate(0 22 22)">' +
  '<circle cx="22" cy="22" r="20" fill="rgba(60,200,230,0.18)" stroke="#3cc8e6" stroke-width="2"/>' +
  '<path d="M22 6 L33 34 L22 28 L11 34 Z" fill="#3cc8e6" stroke="#04212a" stroke-width="2"/>' +
  '</g></svg>';

const TURN_ARROW_MIN_SPEED_MPS = 1; // keep the last heading while parked
const REFOLLOW_MS = 10000; // moving, with no touch this long: follow the truck again

export function createTruck(map, onFollowChange) {
  const icon = L.divIcon({ className: 'truck', html: ARROW_SVG, iconSize: [44, 44], iconAnchor: [22, 22] });
  let marker = null;
  let following = true;
  let last = null;
  let touchedAt = 0; // when a finger last moved the map

  function setFollowing(on) {
    following = on;
    if (on && last) map.setView([last.lat, last.lon], map.getZoom(), { animate: false });
    onFollowChange(on);
  }

  // A finger drag means the driver wants to look around: stop following.
  map.on('dragstart', () => {
    touchedAt = Date.now();
    if (following) setFollowing(false);
  });
  map.on('drag', () => {
    touchedAt = Date.now();
  });
  map.on('dragend', () => {
    touchedAt = Date.now();
  });
  map.on('zoomstart', () => {
    touchedAt = Date.now();
  });

  function update(fix) {
    last = fix;
    const moving = fix.speed !== null && fix.speed >= MOVING_SPEED_MPS;
    // A finger held still on the map fires no drag events: ask Leaflet whether a drag is on.
    const dragging = !!(map.dragging && map.dragging.moving && map.dragging.moving());
    if (!following && moving && !dragging && Date.now() - touchedAt >= REFOLLOW_MS) {
      following = true; // the recenter below does the rest
      onFollowChange(true);
    }
    const latlng = [fix.lat, fix.lon];
    if (!marker) {
      marker = L.marker(latlng, { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else {
      marker.setLatLng(latlng);
    }
    if (fix.bearing !== null && (fix.speed === null || fix.speed >= TURN_ARROW_MIN_SPEED_MPS)) {
      const g = marker.getElement() && marker.getElement().querySelector('g');
      if (g) g.setAttribute('transform', `rotate(${Math.round(fix.bearing)} 22 22)`);
    }
    if (following) map.setView(latlng, map.getZoom(), { animate: false });
  }

  /** Where the truck was last seen: the start view, until a real fix arrives. */
  function setStart(where) {
    if (last) return;
    map.setView([where.lat, where.lon], map.getZoom(), { animate: false });
  }

  return {
    update,
    setFollowing,
    setStart,
    isFollowing: () => following,
  };
}
