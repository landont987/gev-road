// Arizona ADOT traffic cameras: dots on the map, picture on tap.
// Pictures are ~170 KB each, so they load only on a tap (moving or stopped,
// Landon 10/20) and never in low data mode.

import { KEYS, AZ_CAMERAS_URL, AZ511_API_CAMERAS_URL, AZ511_IMAGE_URL, CAMERA_LIST_TTL_MS } from './config.js';
import { parseAzCameras, parseAz511Api } from './parse.js';
import { readCache, writeCache } from './settings.js';
import { el, openSheet, openSheetKind, toast, fetchWithTimeout } from './ui.js';
import { createDotLayer } from './dots.js';
import { nativeFetch } from './native-fetch.js';

// Two caches, so adding or removing the key never shows the other list.
const CACHE_KEY = KEYS.az511 ? 'gev-road-az511-cameras' : 'gev-road-az-cameras';
const PICTURE_TIMEOUT_MS = 20000;
const OFFLINE_CARD = { w: 540, h: 330 }; // measured on offline cameras 1215 and 1217, 2026-10-06
const LIST_RETRY_MS = 60 * 1000; // background loads (spoken alerts) wait this long after a failure

/** app: { isMoving(), isLowData() } */
export function createCameras(map, app) {
  const dots = createDotLayer(map);
  let loading = null;
  let all = []; // every camera, for the spoken alerts and the AI truck check
  let failedAt = 0;
  let enabled = false;
  let current = null; // camera whose sheet is open
  let picture = null; // <img> currently loading or shown
  let pictureTimer = null;
  let pictureBox = null;
  let pictureLowData = null; // the LOW DATA state the open picture box was drawn for

  // With your AZ511 key the list is ADOT's own and up to date; without it,
  // the AZGeo copy (last edited 2026-03-16) still works with no key at all.
  // az511.com sends no CORS header, so on the truck the Android app fetches it
  // (nativeFetch); if that fails, the keyless copy stands in.
  function fetchKeyless() {
    return fetchWithTimeout(AZ_CAMERAS_URL, 20000).then((res) => {
      if (!res.ok) throw new Error(`camera list HTTP ${res.status}`);
      return res.json().then(parseAzCameras);
    });
  }

  // Only the list that matches the key is saved: a stand-in keyless copy is
  // used for this run, and the AZ511 list is tried again on the next start.
  function fetchList() {
    const fetched = KEYS.az511
      ? nativeFetch(`${AZ511_API_CAMERAS_URL}${encodeURIComponent(KEYS.az511)}`, 30000)
          .then((res) => {
            if (!res.ok) throw new Error(`AZ511 camera list HTTP ${res.status}`);
            return res.json().then((json) => ({ cams: parseAz511Api(json, AZ511_IMAGE_URL), save: true }));
          })
          .catch((err) => {
            console.warn('cameras: AZ511 list failed, using the keyless copy:', err.message || err);
            return fetchKeyless().then((cams) => ({ cams, save: false }));
          })
      : fetchKeyless().then((cams) => ({ cams, save: true }));
    return fetched.then(({ cams, save }) => {
      if (cams.length === 0) throw new Error('camera list came back empty');
      if (save) writeCache(CACHE_KEY, cams);
      return cams;
    });
  }

  /** fromSwitch: the CAMERAS button asked, so a failure is shown; background loads stay quiet. */
  function load(fromSwitch) {
    if (loading) return loading;
    if (!fromSwitch && Date.now() - failedAt < LIST_RETRY_MS) return Promise.resolve(0);
    const cached = readCache(CACHE_KEY, CAMERA_LIST_TTL_MS);
    const fresh = () =>
      fetchList().catch((err) => {
        // Cameras rarely move: yesterday's list beats no list.
        const old = readCache(CACHE_KEY, Infinity);
        if (!old) throw err;
        console.warn('cameras: using the saved list; the fresh one failed:', err.message);
        return old;
      });
    loading = (cached ? Promise.resolve(cached) : fresh()).then(
      (cams) => {
        failedAt = 0;
        all = cams;
        dots.setSpots(cams.map((cam) => ({ lat: cam.lat, lon: cam.lon, kind: 'camera', onTap: () => show(cam) })));
        return cams.length;
      },
      (err) => {
        loading = null; // allow a retry: the switch at once, background loads after a minute
        failedAt = Date.now();
        console.warn('cameras:', err);
        if (fromSwitch) toast('Could not load Arizona cameras. Check the hotspot, then switch CAMERAS off and on.');
      },
    );
    return loading;
  }

  function stopPicture() {
    clearTimeout(pictureTimer);
    if (picture) {
      picture.onload = null;
      picture.onerror = null;
      picture.src = ''; // cancels a download still in flight
    }
    picture = null;
  }

  function showFailure(cam, message) {
    stopPicture();
    pictureBox.textContent = '';
    pictureBox.appendChild(el('div', { class: 'note warn' }, message));
    pictureBox.appendChild(el('button', { class: 'pill small wide', onclick: () => renderPicture(cam, true) }, 'TRY AGAIN'));
  }

  // An <img> rather than fetch(): AZ511 sends two Access-Control-Allow-Origin
  // values to scripted requests, which browsers reject. Images need no CORS.
  function loadPicture(cam) {
    stopPicture();
    pictureBox.textContent = '';
    const note = el('div', { class: 'note' }, 'Loading picture...');
    pictureBox.appendChild(note);
    const img = el('img', { class: 'cam-img', alt: cam.name });
    picture = img;
    pictureTimer = setTimeout(() => showFailure(cam, 'The picture is taking too long. Check the hotspot.'), PICTURE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(pictureTimer);
      if (picture !== img) return;
      pictureBox.textContent = '';
      // AZ511 answers a dead camera with a 540x330 "No live camera feed" card.
      if (img.naturalWidth === OFFLINE_CARD.w && img.naturalHeight === OFFLINE_CARD.h) {
        pictureBox.appendChild(el('div', { class: 'note' }, 'This camera is offline right now.'));
        return;
      }
      const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      pictureBox.appendChild(img);
      pictureBox.appendChild(el('p', { class: 'sheet-sub' }, `Picture from ${time}.`));
      pictureBox.appendChild(el('button', { class: 'pill small', onclick: () => renderPicture(cam, true) }, 'REFRESH'));
    };
    img.onerror = () => {
      if (picture === img) showFailure(cam, 'The picture did not load. Check the hotspot.');
    };
    img.src = `${cam.imageUrl}?t=${Date.now()}`;
  }

  /** Show the picture, or say why not. autoLoad is false after a state change, so data is only spent on a tap. */
  function renderPicture(cam, autoLoad) {
    if (!pictureBox) return;
    stopPicture();
    pictureBox.textContent = '';
    pictureLowData = app.isLowData();
    if (pictureLowData) {
      pictureBox.appendChild(el('div', { class: 'note' }, 'Low data is on, so pictures are off to save your hotspot.'));
    } else if (autoLoad) {
      loadPicture(cam);
    } else {
      pictureBox.appendChild(el('button', { class: 'pill wide', onclick: () => renderPicture(cam, true) }, 'SHOW PICTURE'));
    }
  }

  function show(cam) {
    // openSheet first runs the previous sheet's close handler; set current
    // only after it, or tapping a second camera would clear it.
    const body = openSheet('camera', cam.name, () => {
      if (current !== cam) return;
      stopPicture();
      current = null;
      pictureBox = null;
    });
    current = cam;
    const road = [cam.road, cam.direction].filter(Boolean).join(' ');
    if (road) body.appendChild(el('p', { class: 'sheet-sub' }, road));
    pictureBox = el('div');
    body.appendChild(pictureBox);
    body.appendChild(el('p', { class: 'credits' }, 'Camera: ADOT / AZ511. Still pictures, not video.'));
    renderPicture(cam, true);
  }

  return {
    setEnabled(on) {
      // applySettings calls this on every switch; only turning CAMERAS on loads (and may toast).
      const turnedOn = on && !enabled;
      enabled = on;
      dots.setEnabled(on);
      if (turnedOn) load(true);
    },
    /** Every camera, loading the list in the background if needed (also with the layer off). */
    list() {
      load(false);
      return all;
    },
    /**
     * Moving or low data changed. Pictures load while moving too (since 0.3.3),
     * so only a LOW DATA switch redraws: starting or stopping keeps the picture.
     */
    refresh() {
      if (current && openSheetKind() === 'camera' && app.isLowData() !== pictureLowData) renderPicture(current, false);
    },
  };
}
