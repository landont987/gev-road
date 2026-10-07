// The truck arrow and "follow my truck".

import L from 'leaflet';

const ARROW_SVG =
  '<svg width="44" height="44" viewBox="0 0 44 44">' +
  '<g transform="rotate(0 22 22)">' +
  '<circle cx="22" cy="22" r="20" fill="rgba(60,200,230,0.18)" stroke="#3cc8e6" stroke-width="2"/>' +
  '<path d="M22 6 L33 34 L22 28 L11 34 Z" fill="#3cc8e6" stroke="#04212a" stroke-width="2"/>' +
  '</g></svg>';

const TURN_ARROW_MIN_SPEED_MPS = 1; // keep the last heading while parked

export function createTruck(map, onFollowChange) {
  const icon = L.divIcon({ className: 'truck', html: ARROW_SVG, iconSize: [44, 44], iconAnchor: [22, 22] });
  let marker = null;
  let following = true;
  let last = null;

  function setFollowing(on) {
    following = on;
    if (on && last) map.setView([last.lat, last.lon], map.getZoom(), { animate: false });
    onFollowChange(on);
  }

  // A finger drag means the driver wants to look around: stop following.
  map.on('dragstart', () => {
    if (following) setFollowing(false);
  });

  function update(fix) {
    last = fix;
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

  return {
    update,
    setFollowing,
    isFollowing: () => following,
    last: () => last,
  };
}
