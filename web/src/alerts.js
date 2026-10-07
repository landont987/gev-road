// Spoken alerts as the truck moves: plate readers, traffic cameras, speed and
// red-light cameras. This file gathers the spots; alert-logic.js decides what
// is due and what to say.

import { dueAlerts, cameraPlace } from './alert-logic.js';
import { distanceM } from './geo.js';
import { toast } from './ui.js';

const PLATE_RADIUS_M = 1500; // plate reader tiles fetched around the truck
const PLATE_REFRESH_M = 500; // look again after moving this far...
const PLATE_REFRESH_MS = 60 * 1000; // ...or after this long (tiles are cached)
const PLATE_FAILS_TO_WARN = 3; // lookups in a row with no plate data before the driver is told

/** deps: { cameras, plates, speedCameras, voice, settings } */
export function createAlerts(deps) {
  const { cameras, plates, speedCameras, voice, settings } = deps;
  let spoken = {};
  let plateSpots = [];
  let plateLook = null; // { lat, lon, at } of the last plate lookup
  let plateLoading = false;
  let plateFails = 0;
  let cameraList = null;
  let cameraSpots = [];

  function refreshPlates(fix) {
    if (plateLoading) return;
    if (plateLook && distanceM(plateLook, fix) < PLATE_REFRESH_M && Date.now() - plateLook.at < PLATE_REFRESH_MS) return;
    plateLoading = true;
    plateLook = { lat: fix.lat, lon: fix.lon, at: Date.now() };
    plates
      .near(fix.lat, fix.lon, PLATE_RADIUS_M)
      .then(({ records, failed }) => {
        plateSpots = records.map((r) => ({ id: r.id, kind: 'plate', lat: r.lat, lon: r.lon }));
        // Every tile failed with nothing saved: plate alerts are blind until it loads.
        plateFails = failed && !records.length ? plateFails + 1 : 0;
        if (plateFails === PLATE_FAILS_TO_WARN) toast('Plate reader alerts cannot load right now. They come back on their own.', 8000);
      })
      .catch((err) => console.warn('plate alerts:', err))
      .then(() => {
        plateLoading = false;
      });
  }

  function currentCameraSpots() {
    const list = cameras.list();
    if (list !== cameraList) {
      cameraList = list;
      cameraSpots = list.map((c) => ({ id: c.id, kind: 'camera', lat: c.lat, lon: c.lon, name: c.name, place: cameraPlace(c.name) }));
    }
    return cameraSpots;
  }

  return {
    onFix(fix) {
      if (!settings.voice) return;
      let spots = [];
      if (settings.sayPlates) {
        refreshPlates(fix);
        spots = spots.concat(plateSpots);
      }
      if (settings.sayCameras) spots = spots.concat(currentCameraSpots());
      if (settings.sayEnforcement) spots = spots.concat(speedCameras.spots());
      if (!spots.length) return;
      const result = dueAlerts(spots, fix, spoken);
      spoken = result.spoken;
      for (const alert of result.alerts) voice.alert(alert.kind, alert.text);
    },
  };
}
