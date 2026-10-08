// AI truck check: a few seconds after the truck stops near an ADOT camera,
// Gemini looks at that camera's picture for the driver's own truck. The
// picture may be from before the truck got there (the camera posts a new one
// every 30 seconds), so when Gemini does not see it, the app fetches the
// camera's next picture the moment it appears and asks once more.
// A match pings by voice and shows the picture with the truck boxed.
// Each check downloads one picture and sends it to Google: about a third of a
// MB of hotspot; free on Gemini's free tier. Never in low data mode.

import { KEYS, GEMINI_URL, MOVING_SPEED_MPS } from './config.js';
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
  pictureTakenAt,
} from './truck-check-logic.js';
import { el, openSheet, openSheetKind, toast, fetchWithTimeout } from './ui.js';

const STOPPED_MPS = 0.5;
const STOP_SETTLE_MS = 3000; // a stop this long, not a rolling slowdown
const CHECK_RADIUS_M = 300;
const PICTURE_TIMEOUT_MS = 20000;
const AI_TIMEOUT_MS = 30000;
const CAMERA_REFRESH_MS = 30000; // AZ511 serves each camera picture for 30 seconds
const NEXT_PICTURE_MARGIN_MS = 1500; // ask just after the next picture should be up
const WATCH_POLL_MS = 5000; // when the new picture is late
const WATCH_MAX_MS = 45000; // give up on a newer picture after this long
const HEADER_CHARS = 8192; // base64 characters decoded to read the picture size
const REFERENCE_URL = 'truck.jpg'; // the driver's photo, bundled from truck.local.jpg
const CAMERA_COOLDOWN_MS = 15 * 60 * 1000; // stop-and-go by one camera checks it once
const REWARN_MS = 10 * 60 * 1000; // a temporary failure is shown again after this long
const RETRY_AFTER_FAILURE_MS = 60 * 1000; // a temporary failure at a camera is retried after this long
const MAX_RETRIES_PER_STOP = 1; // then it waits for the next stop, so a lasting outage costs little
const FIX_MAX_AGE_MS = 5000; // CHECK NOW needs a current position

/** deps: { app: { isMoving(), isLowData(), isOnline() }, cameras, voice, settings } */
export function createTruckCheck(deps) {
  const { app, cameras, voice, settings } = deps;
  let stoppedSince = null;
  let checkedThisStop = false;
  let retriesThisStop = 0;
  let retryNotBefore = 0; // the one retry waits a minute, even if another camera is in range
  let running = false;
  let last = null; // { cam, at, result?, picture?, offline?, error? }
  let watch = null; // { cam, base64, arrivedAt, nextAt, until }: waiting for the camera's next picture
  let reference; // undefined: not loaded yet; null: no photo bundled
  let stoppedReason = ''; // a permanent error turns the check off until the switch is flipped
  const checkedAt = {}; // camera id -> when it was last checked automatically
  const warnedAt = {}; // error text -> when it was last shown

  function blocker() {
    if (!settings.truckCheck) return 'The AI truck check is off.';
    if (stoppedReason) return `Stopped: ${stoppedReason} Switch AI TRUCK CHECK off and on to try again.`;
    if (!KEYS.gemini) return 'The AI truck check needs your free Gemini key.';
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
        // No Age header: the cache just fetched it from the camera, so it is new.
        const takenAt = pictureTakenAt(Date.now(), res.ageSeconds);
        return res.text().then((base64) => ({ base64, takenAt }));
      })
      .then(({ base64, takenAt }) => {
        const size = imageSize(bytesFromBase64(base64.slice(0, HEADER_CHARS)));
        if (!size) throw new Error('The camera sent something that is not a picture.');
        return { base64, mediaType: size.type === 'png' ? 'image/png' : 'image/jpeg', size, takenAt };
      });
  }

  function askGemini(picture, ref) {
    const body = truckCheckBody({
      camera: { base64: picture.base64, mediaType: picture.mediaType },
      reference: ref,
      description: KEYS.truckDescription,
    });
    return nativeRequest(GEMINI_URL, AI_TIMEOUT_MS, {
      method: 'POST',
      headers: { 'x-goog-api-key': KEYS.gemini, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.text().then((text) => ({ res, text })))
      .then(({ res, text }) => {
        if (!res.ok) {
          const err = new Error(apiErrorText(res.status, text));
          err.permanent = isPermanentApiError(res.status, text);
          throw err;
        }
        let json;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error("Gemini's answer could not be read.");
        }
        return parseTruckCheck(json);
      });
  }

  function warn(err) {
    if (Date.now() - (warnedAt[err.message] || 0) < REWARN_MS) return;
    warnedAt[err.message] = Date.now();
    toast(`AI truck check: ${err.message}`, 8000);
  }

  /** After a "not seen" on a picture from before the stop: wait for the camera's next one. */
  function watchForNewer(cam, picture, arrivedAt) {
    if (picture.takenAt >= arrivedAt) return; // this picture already shows the stop
    const nextAt = picture.takenAt + CAMERA_REFRESH_MS + NEXT_PICTURE_MARGIN_MS;
    watch = { cam, base64: picture.base64, arrivedAt, nextAt, until: Date.now() + WATCH_MAX_MS };
  }

  /** One look at the camera's picture while watching; a new one goes to Gemini. */
  function checkForNewer() {
    const w = watch;
    if (Date.now() > w.until) {
      watch = null;
      return;
    }
    running = true;
    fetchPicture(w.cam)
      .then((picture) => {
        if (watch !== w) return false; // the truck drove off while the picture loaded
        if (picture.base64 === w.base64 || picture.takenAt < w.arrivedAt) {
          w.nextAt = Date.now() + WATCH_POLL_MS;
          return false;
        }
        watch = null;
        run(w.cam, false, picture);
        return true;
      })
      .catch((err) => {
        console.warn(`truck check: the next picture did not load: ${err.message}`);
        w.nextAt = Date.now() + WATCH_POLL_MS;
        return false;
      })
      .then((started) => {
        if (!started) running = false;
      });
  }

  /** picture: one already fetched (the camera's newer picture), else it is fetched now. */
  function run(cam, manual, picture) {
    running = true;
    if (manual) watch = null; // a manual check already looks at the newest picture
    checkedAt[cam.id] = Date.now(); // a manual check also counts, so no automatic one follows it
    const arrivedAt = stoppedSince;
    const done = () => {
      running = false;
      if (manual) toast(lastText(), 8000);
    };
    Promise.all([loadReference(), picture ? Promise.resolve(picture) : fetchPicture(cam)])
      .then(([ref, pic]) => {
        if (isOfflineCard(pic.size)) return { cam, offline: true };
        return askGemini(pic, ref).then((result) => ({ cam, picture: pic, result }));
      })
      .then((outcome) => {
        last = Object.assign({ at: Date.now() }, outcome);
        const r = outcome.result;
        if (r && r.found && r.confidence !== 'low') {
          voice.sayIfOn(`Heads up. Your truck may be on the ${spokenPlace(cam.name)} camera.`);
          showLast();
        } else if (r && !manual && !picture && arrivedAt !== null && stoppedSince === arrivedAt) {
          watchForNewer(cam, outcome.picture, arrivedAt);
        }
      })
      .catch((err) => {
        last = { cam, at: Date.now(), error: err.message };
        console.warn(`truck check: ${err.message}`);
        if (err.permanent || err.message.indexOf('the app blocked this request') === 0) {
          stoppedReason = err.message;
        } else if (!manual && retriesThisStop < MAX_RETRIES_PER_STOP) {
          // A blip, not this camera's fault: one more try in a minute at this same stop.
          retriesThisStop++;
          checkedAt[cam.id] = Date.now() - CAMERA_COOLDOWN_MS + RETRY_AFTER_FAILURE_MS;
          retryNotBefore = Date.now() + RETRY_AFTER_FAILURE_MS;
          checkedThisStop = false;
        }
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
      el('p', { class: 'credits' }, 'AI guess by Gemini (Google). Trucks can look alike. Camera: ADOT / AZ511, a still picture.'),
    );
  }

  function lastText() {
    if (!last) return 'No check yet. It runs a few seconds after you stop within 300 m of an ADOT camera.';
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
      // Automatic checks cost money, so only the real truck's GPS triggers them, never the demo.
      if (fix.source !== 'truck' || fix.speed === null) return; // speed null: cannot tell stopped from moving
      if (fix.speed >= MOVING_SPEED_MPS) {
        stoppedSince = null;
        checkedThisStop = false;
        retriesThisStop = 0;
        retryNotBefore = 0;
        watch = null;
        return;
      }
      if (fix.speed >= STOPPED_MPS) {
        stoppedSince = null;
        return;
      }
      if (stoppedSince === null) stoppedSince = Date.now();
      if (watch && !running && Date.now() >= watch.nextAt) {
        if (blocker()) watch = null;
        else checkForNewer();
        return;
      }
      if (checkedThisStop || running || Date.now() - stoppedSince < STOP_SETTLE_MS) return;
      if (Date.now() < retryNotBefore || blocker()) return;
      const cam = nearestCamera(fix, false);
      if (!cam) return;
      checkedThisStop = true;
      run(cam, false);
    },
    /** The CHECK NOW button: the nearest camera, right away. */
    checkNow(fix, fixAt) {
      const why =
        blocker() ||
        (running ? 'A check is already running.' : '') ||
        (!fix || Date.now() - fixAt > FIX_MAX_AGE_MS ? 'No current GPS position.' : '') ||
        (!cameras.list().length ? 'The camera list has not loaded yet. Check the hotspot.' : '');
      if (why) return why;
      const cam = nearestCamera(fix, true);
      if (!cam) return 'No ADOT camera within 300 m.';
      checkedThisStop = true;
      run(cam, true);
      return `Checking ${cam.name}...`;
    },
    /** Moving changed: hide or show the picture in an open result. */
    refresh() {
      const box = document.getElementById('truck-picture');
      if (box && openSheetKind() === 'truck') renderPicture(box);
    },
    /** The switch was turned back on: forget a permanent error and try again at the next stop. */
    retry() {
      stoppedReason = '';
    },
    showLast,
    lastText,
    status: () => blocker() || 'Ready.',
    hasPhoto: () => loadReference().then((ref) => !!ref),
  };
}
