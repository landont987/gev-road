// The plate-reader detector on the map: a pin where the truck was when a Flock
// camera's radio was loudest, and "Plate reader camera detected" out loud.
// The board (flock-you on a Seeed XIAO ESP32-S3, MIT, colonelpanichacks/flock-you)
// sits on the head unit's USB; the Android app (Detector.java) hands each of its
// lines to window.gevOnDetectorLine and its connection state to gevOnDetectorState.

import L from 'leaflet';
import { dot } from './dots.js';
import { el, openSheet } from './ui.js';
import {
  parseDetectorLine,
  mergeDetection,
  speakDecision,
  emptySpeechState,
  isRecord,
  tierLabel,
  statusText,
  PIN_MIN_TIER,
  STRONG_TIER,
  DETECTION_TEXT,
} from './detector-logic.js';

const STORE_KEY = 'gev-road-detections';
const SAVE_EVERY_MS = 60 * 1000; // repeat hits only bump counts: saved at most this often

function hasNative() {
  return !!(window.GevNative && typeof window.GevNative.detectorStatus === 'function');
}

/** deps: { map, voice, settings, getFix() -> { lat, lon, at } | null } */
export function createDetector(deps) {
  const { map, voice, settings, getFix } = deps;
  const group = L.layerGroup();
  const stateWatchers = [];
  let records = load();
  let speech = emptySpeechState();
  let enabled = false;
  let savedAt = 0;

  function load() {
    try {
      const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(list) ? list.filter(isRecord) : [];
    } catch (err) {
      return [];
    }
  }

  function save() {
    savedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch (err) {
      // Not saved: the pins still show until the app closes.
    }
  }

  function show(r) {
    const body = openSheet('heard', 'Plate-reader camera heard');
    const time = (ms) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Last heard'), time(r.lastAt)));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'First heard'), time(r.firstAt)));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Times heard'), String(r.count)));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Confidence'), tierLabel(r.tier)));
    body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'Loudest'), r.rssi === null ? 'Not recorded' : `${r.rssi} dBm`));
    body.appendChild(
      el('p', { class: 'sheet-sub' }, "The pin is where the truck was when this camera's radio was loudest, not the camera itself."),
    );
    body.appendChild(
      el(
        'p',
        { class: 'credits' },
        'Heard by your flock-you board (MIT license, colonelpanichacks), which only listens. ' +
          'Detection research: @NitekryDPaul, DeFlockJoplin.',
      ),
    );
  }

  function draw() {
    group.clearLayers();
    for (const r of records) {
      if (r.lat === null || r.tier < PIN_MIN_TIER) continue;
      dot(r.lat, r.lon, r.tier >= STRONG_TIER ? 'heard' : 'heard-weak', () => show(r)).addTo(group);
    }
  }

  function onLine(line) {
    const det = parseDetectorLine(line);
    if (!det || det.tier < PIN_MIN_TIER) return;
    const now = Date.now();
    const merged = mergeDetection(records, det, getFix(), now);
    records = merged.records;
    if (merged.changed || now - savedAt > SAVE_EVERY_MS) save();
    if (merged.changed && enabled) draw();
    const decision = speakDecision(det, speech, now, settings.detectorWeakHits);
    speech = decision.state;
    if (decision.speak) voice.alert('detector', DETECTION_TEXT);
  }

  function nativeState() {
    if (!hasNative()) return null;
    try {
      return JSON.parse(window.GevNative.detectorStatus());
    } catch (err) {
      console.warn('detector state:', err);
      return null;
    }
  }

  window.gevOnDetectorLine = (line) => {
    try {
      onLine(line);
    } catch (err) {
      console.warn('detector line:', err);
    }
  };
  window.gevOnDetectorState = () => {
    for (const watcher of stateWatchers) watcher();
  };

  return {
    setEnabled(on) {
      enabled = on;
      if (on) {
        draw();
        group.addTo(map);
      } else {
        map.removeLayer(group);
      }
    },
    /** Called when the app reports a new connection state (the open panel redraws). */
    onStateChange(fn) {
      stateWatchers.push(fn);
    },
    hasNative,
    /** The app's { state, problem, lines, autoOpen, usbHost }, or null outside the app. */
    status: nativeState,
    statusText: () => statusText(nativeState()),
    autoOpen: () => {
      const s = nativeState();
      return !!(s && s.autoOpen);
    },
    connect() {
      if (hasNative()) window.GevNative.detectorConnect();
    },
    setAutoOpen(on) {
      if (hasNative()) window.GevNative.detectorAutoOpen(!!on);
    },
    count: () => records.filter((r) => r.lat !== null).length,
    clear() {
      records = [];
      save();
      draw();
    },
  };
}
