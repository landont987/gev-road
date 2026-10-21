// GEV Road: wires the map, the truck, the layers and the buttons together.

import L from 'leaflet';
import {
  BASEMAP_URL,
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM,
  START_VIEW,
  DRIVE_ZOOM,
  LOW_DATA_MAX_ZOOM,
  MOVING_SPEED_MPS,
  DATA_WARN_BYTES,
} from './config.js';
import { $, setOn, toast, closeSheet, openSheetKind } from './ui.js';
import { withSpeed } from './fix-logic.js';
import { gpsShortText, gpsMenuText, gpsSpokenProblem } from './gps-logic.js';
import { loadSettings, saveSettings } from './settings.js';
import { createGps } from './gps.js';
import { createTruck } from './truck.js';
import { createCameras } from './cameras.js';
import { createPlates } from './plates.js';
import { createTraffic } from './traffic.js';
import { createRouting } from './routing.js';
import { createRadio } from './radio.js';
import { openMenu, memoryText as memoryLine } from './menu.js';
import { createVoice } from './voice.js';
import { createAlerts } from './alerts.js';
import { createSpeedCameras } from './speed-cameras.js';
import { createTruckCheck } from './truck-check.js';
import { openVoicePanel } from './voice-panel.js';
import { createDetector } from './detector.js';
import { openDetectorPanel } from './detector-panel.js';
import { createEngine } from './engine.js';
import { openEnginePanel } from './engine-panel.js';
import { createRoad } from './road.js';

const settings = loadSettings();
const MPS_TO_MPH = 2.23694;
const GPS_STALE_MS = 5000;
const GPS_LOST_MS = 15000; // "GPS signal lost" after this long without a fix
const NETWORK_SETTLE_MS = 5000; // a hotspot blip shorter than this is not spoken

const map = L.map('map', {
  zoomControl: false,
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false,
  inertia: false,
  attributionControl: true,
}).setView([START_VIEW.lat, START_VIEW.lon], START_VIEW.zoom);

const basemap = L.tileLayer(BASEMAP_URL, {
  maxZoom: BASEMAP_MAX_ZOOM,
  attribution: BASEMAP_ATTRIBUTION,
  updateWhenIdle: true,
  keepBuffer: settings.lowData ? 0 : 1,
}).addTo(map);


let lastFix = null;
let lastFixAt = 0;
let moving = false;
let online = true; // until the app says otherwise
let appVisible = true; // the GPS is stopped while the app is in the background
let visibleSince = Date.now();

const app = {
  isMoving: () => moving,
  isLowData: () => settings.lowData,
  // Where routes start: the truck when the GPS is fresh, otherwise the middle of the map.
  origin: () =>
    lastFix && Date.now() - lastFixAt < GPS_STALE_MS
      ? { lat: lastFix.lat, lon: lastFix.lon, fromGps: true }
      : { lat: map.getCenter().lat, lon: map.getCenter().lng, fromGps: false },
  isFollowing: () => truck.isFollowing(),
  // Live from the app: "connected", which some head units report even when
  // their internet check never passes. A failed request is reported anyway.
  isOnline: () => (window.GevNative && typeof window.GevNative.isOnline === 'function' ? !!window.GevNative.isOnline() : online),
  say: (kind, text) => voice.alert(kind, text),
};

const truck = createTruck(map, (following) => {
  $('btn-recenter').hidden = following;
});
const cameras = createCameras(map, app);
const plates = createPlates(map);
const traffic = createTraffic(map);
const routing = createRouting(map, app);
const radio = createRadio(app);
radio.onChange((playingId) => setOn($('btn-radio'), !!playingId));
const voice = createVoice(settings);
const alerts = createAlerts({ cameras, plates, speedCameras: createSpeedCameras(), voice, settings });
const truckCheck = createTruckCheck({ app, cameras, voice, settings });
const engine = createEngine({ voice });
const road = createRoad({
  map,
  voice,
  settings,
  app,
  getFix: () => (lastFix && Date.now() - lastFixAt < GPS_STALE_MS ? lastFix : null),
});
const detector = createDetector({
  map,
  voice,
  settings,
  getFix: () => (lastFix ? { lat: lastFix.lat, lon: lastFix.lon, at: lastFixAt } : null),
});

// The hotspot dropping or coming back, from the Android app (or the browser).
let spokenOnline = true;
let networkTimer = null;
function onNetwork(on) {
  online = on;
  clearTimeout(networkTimer);
  networkTimer = setTimeout(() => {
    if (online === spokenOnline) return;
    spokenOnline = online;
    voice.alert('link', online ? 'Back online.' : 'Hotspot connection lost.');
  }, NETWORK_SETTLE_MS);
}
window.gevOnNetwork = onNetwork;
if (window.GevNative && typeof window.GevNative.isOnline === 'function') {
  // The app's own check ("has working internet") is the only source here: the
  // browser's online event fires on any Wi-Fi, even a hotspot with no data.
  try {
    online = !!window.GevNative.isOnline();
    spokenOnline = online;
  } catch (err) {
    console.warn('network state:', err);
  }
} else {
  window.addEventListener('online', () => onNetwork(true));
  window.addEventListener('offline', () => onNetwork(false));
}
window.gevOnAppVisible = (visible) => {
  appVisible = !!visible;
  if (visible) visibleSince = Date.now();
};

function dataBytes() {
  if (!window.GevNative) return null;
  try {
    const bytes = Number(window.GevNative.dataBytes());
    return bytes >= 0 ? bytes : null; // -1: this unit does not report per-app data
  } catch (err) {
    console.warn('data meter:', err);
    return null;
  }
}

function dataText() {
  const bytes = dataBytes();
  if (bytes === null) return 'Data used: shown on the truck (the data meter reads the Android app).';
  return `Data used since the app opened: ${(bytes / 1048576).toFixed(1)} MB.`;
}

/** The MEMORY line for the menu: read from the app each time the menu opens (a blocking bridge call, so only on a tap). */
function memoryText() {
  if (!window.GevNative || typeof window.GevNative.memoryJson !== 'function') return memoryLine(null);
  try {
    return memoryLine(window.GevNative.memoryJson());
  } catch (err) {
    console.warn('memory meter:', err);
    return memoryLine(null);
  }
}

let dataWarned = false;
let gpsLostSpoken = false;
/** The data meter: a bridge call into the app, so only every 5 s (the interval), not on every fix (#55). */
function updateData() {
  const bytes = dataBytes();
  $('data-used').textContent = bytes === null ? 'DATA --' : `DATA ${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes !== null && bytes > DATA_WARN_BYTES && !settings.lowData && !dataWarned) {
    dataWarned = true;
    toast('This app has used over 100 MB. Tap LOW DATA to save your hotspot.', 8000);
    voice.alert('trip', 'This app has used over 100 megabytes of hotspot data.');
  }
}

function updateStatus() {
  const fresh = lastFix && Date.now() - lastFixAt < GPS_STALE_MS;
  const speed = fresh && lastFix.speed !== null ? Math.round(lastFix.speed * MPS_TO_MPH) : null;
  $('speed').textContent = speed === null ? '--' : String(speed);
  $('gps-state').textContent = !fresh ? gpsShortText(gps.status()) : lastFix.source === 'demo' ? 'DEMO GPS' : 'GPS OK';
  engine.paint();
  const silentFor = Date.now() - Math.max(lastFixAt, visibleSince);
  if (appVisible && !gpsLostSpoken && lastFix && lastFix.source === 'truck' && silentFor > GPS_LOST_MS) {
    gpsLostSpoken = true;
    voice.alert('link', 'GPS signal lost.');
  }
}

function applySettings() {
  saveSettings(settings);
  setOn($('btn-cameras'), settings.cameras);
  setOn($('btn-plates'), settings.plates);
  setOn($('btn-traffic'), settings.traffic && !settings.lowData);
  setOn($('btn-lowdata'), settings.lowData);
  setOn($('btn-drive'), settings.drive);
  $('btn-traffic').disabled = settings.lowData;
  $('lowdata-badge').hidden = !settings.lowData;
  document.body.classList.toggle('drive', settings.drive);
  basemap.options.keepBuffer = settings.lowData ? 0 : 1;
  const maxZoom = settings.lowData ? LOW_DATA_MAX_ZOOM : BASEMAP_MAX_ZOOM;
  map.setMaxZoom(maxZoom);
  if (map.getZoom() > maxZoom) map.setZoom(maxZoom, { animate: false });
  cameras.setEnabled(settings.cameras);
  road.setEnabled(settings.roadInfo);
  plates.setEnabled(settings.plates);
  detector.setEnabled(settings.plates);
  radio.onLowData(settings.lowData);
  traffic.setEnabled(settings.traffic && !settings.lowData);
  cameras.refresh();
  if (settings.drive) {
    map.dragging.disable();
    truck.setFollowing(true);
    if (map.getZoom() < DRIVE_ZOOM - 2) map.setZoom(Math.min(DRIVE_ZOOM, maxZoom), { animate: false });
  } else {
    map.dragging.enable();
  }
  updateStatus();
  updateData();
}

function onFix(raw) {
  const fix = withSpeed(raw, lastFix, lastFixAt, Date.now());
  lastFix = fix;
  lastFixAt = Date.now();
  if (gpsLostSpoken) {
    gpsLostSpoken = false;
    voice.alert('link', 'GPS is back.');
  }
  truck.update(fix);
  // Add-ons must never stop the speed, the moving flag, the status or each other.
  try {
    routing.update(fix);
  } catch (err) {
    console.warn('route:', err);
  }
  try {
    alerts.onFix(fix);
  } catch (err) {
    console.warn('alerts:', err);
  }
  try {
    road.onFix(fix);
  } catch (err) {
    console.warn('road info:', err);
  }
  try {
    truckCheck.onFix(fix);
  } catch (err) {
    console.warn('truck check:', err);
  }
  const nowMoving = fix.speed !== null && fix.speed >= MOVING_SPEED_MPS;
  if (nowMoving !== moving) {
    moving = nowMoving;
    cameras.refresh();
    truckCheck.refresh();
    // Setup buttons and steps show only while parked.
    if (openSheetKind() === 'detector') openDetector();
    if (openSheetKind() === 'engine') openEngine();
  }
  updateStatus();
}

const startedAt = Date.now();
let gpsProblemSpoken = '';
// The app's GPS state (#64): the status card shows it while there is no fix, and a
// GPS that cannot work (location off, permission refused) is spoken once.
function onGpsStatus(status) {
  updateStatus();
  const problem = gpsSpokenProblem(status);
  if (problem && problem !== gpsProblemSpoken) {
    gpsProblemSpoken = problem;
    toast(problem, 8000);
    voice.alert('link', problem);
  }
}
const gps = createGps(onFix, { onStatus: onGpsStatus, onLastKnown: (where) => truck.setStart(where) });
function gpsText() {
  return gpsMenuText(gps.readStatus(), Math.round((Date.now() - startedAt) / 1000));
}
setInterval(() => {
  updateStatus();
  updateData();
}, GPS_STALE_MS);

function toggle(name) {
  return () => {
    settings[name] = !settings[name];
    applySettings();
  };
}

$('btn-cameras').addEventListener('click', toggle('cameras'));
$('btn-plates').addEventListener('click', toggle('plates'));
$('btn-lowdata').addEventListener('click', toggle('lowData'));
$('btn-drive').addEventListener('click', () => {
  closeSheet();
  toggle('drive')();
});
$('btn-traffic').addEventListener('click', () => {
  if (!traffic.hasKey()) {
    toast('Live traffic needs your free TomTom key. It is not set yet.');
    return;
  }
  toggle('traffic')();
});
$('btn-route').addEventListener('click', () => routing.openSearch());
$('btn-radio').addEventListener('click', () => radio.openList());
$('btn-zoom-in').addEventListener('click', () => map.zoomIn(1, { animate: false }));
$('btn-zoom-out').addEventListener('click', () => map.zoomOut(1, { animate: false }));
function openVoice() {
  openVoicePanel({ settings, save: applySettings, voice, truckCheck, lastFix: () => lastFix, lastFixAt: () => lastFixAt });
}
function openDetector() {
  openDetectorPanel({ detector, settings, save: applySettings, isMoving: () => moving });
}
detector.onStateChange(() => {
  if (openSheetKind() === 'detector') openDetector();
});
function openEngine() {
  openEnginePanel({ engine, isMoving: () => moving });
}
$('btn-menu').addEventListener('click', () => openMenu({ gps, traffic, routing, dataText, memoryText, gpsText, openVoice, openDetector, openEngine }));
$('btn-recenter').addEventListener('click', () => truck.setFollowing(true));
$('btn-sheet-close').addEventListener('click', closeSheet);
// A long press asks "Drive here?", but never while moving: that sheet needs a tap to close (#54).
map.on('contextmenu', (e) => {
  if (!moving) routing.confirmPoint(e.latlng);
});

applySettings();
