// Map dots (cameras, plate readers) as small DOM markers: a 40px invisible
// tap box around a visible dot, sized for a finger on a 7-inch screen.
// Not L.canvas: the Android 9 test WebView (Chrome 66) never puts large,
// GPU-backed canvases on screen, so canvas dots were drawn but invisible.

import L from 'leaflet';

const TAP_BOX_PX = 40;
const icons = {};

/** kind is 'camera' or 'plate'; the look lives in style.css (.dot-camera, .dot-plate). */
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
