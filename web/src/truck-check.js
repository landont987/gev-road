// AI truck check: when the truck has sat still near an ADOT camera, Claude
// looks at that camera's picture for the driver's own truck, once per stop.
// A match pings by voice and shows the picture with the truck boxed.
// Each check downloads one picture and sends it to Anthropic: about half a MB
// of hotspot and 1 to 2 cents. Never in low data mode.

import { KEYS, ANTHROPIC_URL, ANTHROPIC_VERSION, TRUCK_CHECK_MODEL, MOVING_SPEED_MPS } from './config.js';
import { distanceM } from './geo.js';
import { spokenPlace } from './alert-logic.js';
import { nativeRequest, hasNativeRequest } from './native-fetch.js';
import {
  imageSize,
  isOfflineCard,
  bytesFromBase64,
  base64FromBytes,
  truckCheckBody,
  parseTruckCheck,
  apiErrorText,
  isPermanentApiError,
} from './truck-check-logic.js';
import { el, openSheet, openSheetKind, toast, fetchWithTimeout } from './ui.js';

const STOPPED_MPS = 0.5;
const STOP_SETTLE_MS = 10000; // a stop this long, not a rolling slowdown
const CHECK_RADIUS_M = 300;
const PICTURE_TIMEOUT_MS = 20000;
const AI_TIMEOUT_MS = 60000;
const HEADER_CHARS = 8192; // base64 characters decoded to read the picture size
const REFERENCE_URL = 'truck.jpg'; // the driver's photo, bundled from truck.local.jpg
const CAMERA_COOLDOWN_MS = 15 * 60 * 1000; // stop-and-go by one camera checks it once
const REWARN_MS = 10 * 60 * 1000; // a temporary failure is shown again after this long

/** deps: { app: { isMoving(), isLowData(), isOnline() }, cameras, voice, settings } */
export function createTruckCheck(deps) {
  const { app, cameras, voice, settings } = deps;
  let stoppedSince = null;
  let checkedThisStop = false;
  let running = false;
  let last = null; // { cam, at, result?, picture?, offline?, error? }
  let reference; // undefined: not loaded yet; null: no photo bundled
  let stoppedReason = ''; // a permanent error turns the check off until the switch is flipped
  const checkedAt = {}; // camera id -> when it was last checked automatically
  const warnedAt = {}; // error text -> when it was last shown

  function blocker() {
    if (!settings.truckCheck) {
      stoppedReason = ''; // switching it off and on again retries
      return 'The AI truck check is off.';
    }
    if (stoppedReason) return `Stopped: ${stoppedReason} Switch AI TRUCK CHECK off and on to try again.`;
    if (!KEYS.anthropic) return 'The AI truck check needs your Anthropic key.';
    if (!hasNativeRequest()) return 'The AI truck check runs in the Android app only.';
    if (app.isLowData()) return 'Low data is on, so the AI truck check is off.';
    if (!app.isOnline()) return 'No internet right now.';
    return '';
  }

  /** Nearest camera within 300 m; automatic checks skip one checked in the last 15 minutes. */
  function nearestCamera(fix, manual) {
    let best = null;
    let bestM = CHECK_RADIUS_M;
    for (const cam of cameras.list()) {
      if (!manual && Date.now() - (checkedAt[cam.id] || 0) < CAMERA_COOLDOWN_MS) continue;
      const d = distanceM(fix, cam);
      if (d <= bestM) {
        best = cam;
        bestM = d;
      }
    }
    return best;
  }

  function loadReference() {
    if (reference !== undefined) return Promise.resolve(reference);
    return fetchWithTimeout(REFERENCE_URL, 10000)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => (buf && buf.byteLength ? { base64: base64FromBytes(new Uint8Array(buf)), mediaType: 'image/jpeg' } : null))
      .catch((err) => {
        // In the app a missing asset fails to load rather than answering 404.
        console.warn(`truck check: truck photo did not load: ${err.message}`);
        return null;
      })
      .then((ref) => {
        if (!ref) console.warn('truck check: no truck photo, using the description only');
        reference = ref;
        return ref;
      });
  }

  function fetchPicture(cam) {
    return nativeRequest(cam.imageUrl, PICTURE_TIMEOUT_MS, { method: 'GET', headers: { Accept: 'image/*' }, base64: true })
      .then((res) => {
        if (!res.ok) throw new Error(`The camera picture did not load (HTTP ${res.status}).`);
        return res.text();
      })
      .then((base64) => {
        const size = imageSize(bytesFromBase64(base64.slice(0, HEADER_CHARS)));
        if (!size) throw new Error('The camera sent something that is not a picture.');
        return { base64, mediaType: size.type === 'png' ? 'image/png' : 'image/jpeg', size };
      });
  }

  function askClaude(picture, ref) {
    const body = truckCheckBody({
      model: TRUCK_CHECK_MODEL,
      camera: { base64: picture.base64, mediaType: picture.mediaType, width: picture.size.width, height: picture.size.height },
      reference: ref,
      description: KEYS.truckDescription,
    });
    return nativeRequest(ANTHROPIC_URL, AI_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'x-api-key': KEYS.anthropic, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.text().then((text) => ({ res, text })))
      .then(({ res, text }) => {
        if (!res.ok) {
          const err = new Error(apiErrorText(res.status, text));
          err.permanent = isPermanentApiError(res.status);
          throw err;
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error("Claude's answer could not be read.");
        }
        return parseTruckCheck(json, picture.size);
      });
  }

  function warn(err) {
    if (Date.now() - (warnedAt[err.message] || 0) < REWARN_MS) return;
    warnedAt[err.message] = Date.now();
    toast(`AI truck check: ${err.message}`, 8000);
  }

  function run(cam, manual) {
    running = true;
    if (!manual) checkedAt[cam.id] = Date.now();
    const done = () => {
      running = false;
      if (manual) toast(lastText(), 8000);
    };
    Promise.all([loadReference(), fetchPicture(cam)])
      .then(([ref, picture]) => {
        if (isOfflineCard(picture.size)) return { cam, offline: true };
        return askClaude(picture, ref).then((result) => ({ cam, picture, result }));
      })
      .then((outcome) => {
        last = Object.assign({ at: Date.now() }, outcome);
        if (outcome.result && outcome.result.found && outcome.result.confidence !== 'low') {
          voice.sayIfOn(`Heads up. Your truck may be on the ${spokenPlace(cam.name)} camera.`);
          showLast();
        }
      })
      .catch((err) => {
        last = { cam, at: Date.now(), error: err.message };
        console.warn(`truck check: ${err.message}`);
        if (err.permanent) stoppedReason = err.message;
        if (!manual) warn(err);
      })
      .then(done, done);
  }

  function renderPicture(box) {
    box.textContent = '';
    if (!last || !last.picture) return;
    if (app.isMoving()) {
      box.appendChild(el('div', { class: 'note' }, 'The picture shows when the truck is stopped.'));
      return;
    }
    const snap = el('div', { class: 'snap' });
    snap.appendChild(el('img', { class: 'cam-img', alt: last.cam.name, src: `data:${last.picture.mediaType};base64,${last.picture.base64}` }));
    const r = last.result.box;
    if (r) {
      snap.appendChild(
        el('div', { class: 'snap-box', style: `left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%` }),
      );
    }
    box.appendChild(snap);
  }

  function showLast() {
    const body = openSheet('truck', last ? last.cam.name : 'AI truck check');
    body.appendChild(el('p', { class: 'sheet-sub' }, lastText()));
    const box = el('div', { id: 'truck-picture' });
    body.appendChild(box);
    renderPicture(box);
    if (last && last.result && last.result.note) body.appendChild(el('p', { class: 'kv' }, el('b', {}, 'AI'), last.result.note));
    body.appendChild(
      el('p', { class: 'credits' }, 'AI guess by Claude (Anthropic). Trucks can look alike. Camera: ADOT / AZ511, a still picture.'),
    );
  }

  function lastText() {
    if (!last) return 'No check yet. It runs when you stop within 300 m of an ADOT camera.';
    const time = new Date(last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const where = `${last.cam.name}, ${time}`;
    if (last.error) return `${where}: ${last.error}`;
    if (last.offline) return `${where}: that camera is offline.`;
    const r = last.result;
    if (!r.found) return `${where}: your truck was not seen.`;
    return `${where}: your truck may be there (${r.confidence} confidence).`;
  }

  return {
    onFix(fix) {
      if (fix.speed === null) return; // cannot tell stopped from moving
      if (fix.speed >= MOVING_SPEED_MPS) {
        stoppedSince = null;
        checkedThisStop = false;
        return;
      }
      if (fix.speed >= STOPPED_MPS) {
        stoppedSince = null;
        return;
      }
      if (stoppedSince === null) stoppedSince = Date.now();
      if (checkedThisStop || running || Date.now() - stoppedSince < STOP_SETTLE_MS || blocker()) return;
      const cam = nearestCamera(fix, false);
      if (!cam) return;
      checkedThisStop = true;
      run(cam, false);
    },
    /** The CHECK NOW button: the nearest camera, right away. */
    checkNow(fix) {
      const why = blocker() || (running ? 'A check is already running.' : '') || (!fix ? 'No GPS fix yet.' : '');
      if (why) return why;
      const cam = nearestCamera(fix, true);
      if (!cam) return 'No ADOT camera within 300 m.';
      run(cam, true);
      return `Checking ${cam.name}...`;
    },
    /** Moving changed: hide or show the picture in an open result. */
    refresh() {
      const box = document.getElementById('truck-picture');
      if (box && openSheetKind() === 'truck') renderPicture(box);
    },
    showLast,
    lastText,
    status: () => blocker() || 'Ready.',
    hasPhoto: () => loadReference().then((ref) => !!ref),
  };
}
