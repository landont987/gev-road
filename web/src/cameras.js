// Arizona ADOT traffic cameras: dots on the map, picture on tap.
// Pictures are ~170 KB each, so they load only on a tap, only while the
// truck is stopped, and never in low data mode.

import L from 'leaflet';
import { KEYS, AZ_CAMERAS_URL, AZ511_API_CAMERAS_URL, AZ511_IMAGE_URL, CAMERA_LIST_TTL_MS } from './config.js';
import { parseAzCameras, parseAz511Api } from './parse.js';
import { readCache, writeCache } from './settings.js';
import { el, openSheet, openSheetKind, toast, fetchWithTimeout } from './ui.js';

// Two caches, so adding or removing the key never shows the other list.
const CACHE_KEY = KEYS.az511 ? 'gev-road-az511-cameras' : 'gev-road-az-cameras';
const PICTURE_TIMEOUT_MS = 20000;
const OFFLINE_CARD = { w: 540, h: 330 }; // measured on offline cameras 1215 and 1217, 2026-10-06

/** app: { isMoving(), isLowData() } */
export function createCameras(map, renderer, app) {
  const group = L.layerGroup();
  let loading = null;
  let current = null; // camera whose sheet is open
  let picture = null; // <img> currently loading or shown
  let pictureTimer = null;
  let pictureBox = null;

  // With your AZ511 key the list is ADOT's own and up to date; without it,
  // the AZGeo copy (last edited 2026-03-16) still works with no key at all.
  function fetchList() {
    const url = KEYS.az511 ? `${AZ511_API_CAMERAS_URL}${encodeURIComponent(KEYS.az511)}` : AZ_CAMERAS_URL;
    return fetchWithTimeout(url, 20000)
      .then((res) => {
        if (!res.ok) throw new Error(`camera list HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const cams = KEYS.az511 ? parseAz511Api(json, AZ511_IMAGE_URL) : parseAzCameras(json);
        if (cams.length === 0) throw new Error('camera list came back empty');
        writeCache(CACHE_KEY, cams);
        return cams;
      });
  }

  function load() {
    if (loading) return loading;
    const cached = readCache(CACHE_KEY, CAMERA_LIST_TTL_MS);
    loading = (cached ? Promise.resolve(cached) : fetchList()).then(
      (cams) => {
        for (const cam of cams) {
          L.circleMarker([cam.lat, cam.lon], {
            renderer,
            radius: 8,
            color: '#04212a',
            weight: 2,
            fillColor: '#3cc8e6',
            fillOpacity: 1,
          })
            .on('click', () => show(cam))
            .addTo(group);
        }
        return cams.length;
      },
      (err) => {
        loading = null; // allow a retry next time the layer is switched on
        console.warn('cameras:', err);
        toast('Could not load Arizona cameras. Check the hotspot, then switch CAMERAS off and on.');
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
    pictureBox.appendChild(el('button', { class: 'pill small wide', onclick: () => loadPicture(cam) }, 'TRY AGAIN'));
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
      pictureBox.appendChild(el('button', { class: 'pill small', onclick: () => loadPicture(cam) }, 'REFRESH'));
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
    if (app.isLowData()) {
      pictureBox.appendChild(el('div', { class: 'note' }, 'Low data is on, so pictures are off to save your hotspot.'));
    } else if (app.isMoving()) {
      pictureBox.appendChild(el('div', { class: 'note' }, 'Pictures show when the truck is stopped.'));
    } else if (autoLoad) {
      loadPicture(cam);
    } else {
      pictureBox.appendChild(el('button', { class: 'pill wide', onclick: () => loadPicture(cam) }, 'SHOW PICTURE'));
    }
  }

  function show(cam) {
    current = cam;
    const body = openSheet('camera', cam.name, () => {
      stopPicture();
      current = null;
      pictureBox = null;
    });
    const road = [cam.road, cam.direction].filter(Boolean).join(' ');
    if (road) body.appendChild(el('p', { class: 'sheet-sub' }, road));
    pictureBox = el('div');
    body.appendChild(pictureBox);
    body.appendChild(el('p', { class: 'credits' }, 'Camera: ADOT / AZ511. Still pictures, not video.'));
    renderPicture(cam, true);
  }

  return {
    setEnabled(on) {
      if (on) {
        group.addTo(map);
        load();
      } else {
        map.removeLayer(group);
      }
    },
    /** Moving or low data changed: hide a picture that is no longer allowed. */
    refresh() {
      if (current && openSheetKind() === 'camera') renderPicture(current, false);
    },
  };
}
