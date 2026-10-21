// RADIO: police, fire and highway patrol you can listen to while driving.
//
// Everything plays inside the app, never in a web page:
//  1. LIVE CALLS: Broadcastify Calls through their licensed API. The channel
//     list is read live for the county the truck is in (calls-directory.js),
//     so only channels that are actually talking show up.
//  2. RADIO STATIONS: public broadcast streams from the Radio Browser directory.
//  3. MY SCANNER: a stream from your own receiver (an RTL-SDR box running
//     trunk-recorder, SDRTrunk or OP25 that streams MP3 over the hotspot).

import { KEYS } from './config.js';
import { fetchCounty, fetchStations, sortStations } from './stations.js';
import { groupName } from './calls-groups.js';
import { fetchChannels } from './calls-directory.js';
import { buildPacks, channelList, ageText, LIVE_WINDOW_S } from './calls-directory-logic.js';
import { createCallsPlayer, hasCallsKeys } from './calls.js';
import { distanceM } from './geo.js';
import { el, openSheet, closeSheet, openSheetKind, toast } from './ui.js';
import { trackPlayer } from './audio-duck.js';
import { watchStream } from './stream-retry.js';

const STORE_KEY = 'gev-road-radio';
const MY_SCANNER_RETRY_MS = 4000;
// A dead or mistyped stream never plays: give up after this many restarts in a row
// (about 80 s of error/ended retries, longer if stalls pace them) instead of retrying
// on the hotspot forever. A hotspot blip that plays again resets the count.
const STREAM_MAX_FAILURES = 20;
const STREAM_STALL_MS = 15000; // no data this long after "stalled": the stream is dead, not slow
const M_PER_MILE = 1609.344;
const CHANNELS_RETRY_MS = 5 * 60 * 1000; // the live channel list is read again this often while the sheet is used

function loadStore() {
  try {
    return Object.assign(
      { lastFeedId: '', myScannerUrl: '', bcfyUser: '', bcfyPass: '', callsPick: '' },
      JSON.parse(localStorage.getItem(STORE_KEY) || '{}'),
    );
  } catch (err) {
    return { lastFeedId: '', myScannerUrl: '', bcfyUser: '', bcfyPass: '', callsPick: '' };
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (err) {
    // Not saved: the choice still holds for this session.
  }
}

/** Feeds sorted by distance from the truck, nearest first. Pure, for tests. */
export function sortFeedsByDistance(feeds, origin) {
  return feeds
    .map((feed) => ({ feed, miles: distanceM(origin, feed.area) / M_PER_MILE }))
    .sort((a, b) => a.miles - b.miles);
}

/**
 * The Broadcastify login for the live calls: typed on the unit once, or built into
 * the app from keys.local.json so nothing is ever typed there (#66). Pure, for tests.
 */
export function callsLogin(store, keys) {
  // Both halves from one place: a typed username never borrows the built-in password.
  const typed = (store.bcfyUser || '').trim();
  if (typed) return { username: typed, password: store.bcfyPass || '', builtIn: false };
  const builtIn = (keys.bcfyUser || '').trim();
  if (builtIn && keys.bcfyPass) return { username: builtIn, password: keys.bcfyPass, builtIn: true };
  return { username: '', password: '', builtIn: false };
}

/** Only http(s) stream addresses are accepted for MY SCANNER. Pure, for tests. */
export function cleanStreamUrl(text) {
  const value = String(text || '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(value)) return '';
  return value;
}

/** app: { origin() } */
export function createRadio(app) {
  const store = loadStore();
  const native = window.GevNative && typeof window.GevNative.radioOpen === 'function' ? window.GevNative : null;
  let audio = null; // <audio> for MY SCANNER
  let playingId = ''; // feed id, 'mine', 'calls' or 'station:<id>'
  let playingLabel = '';
  let county = null; // { ctid, name } for the truck's position
  let onChange = () => {};
  let callsStatus = ''; // "signing in", "listening", "2 waiting"
  let callsNow = null; // the call playing right now
  let callsLine = null; // status element in the open sheet, when it is open
  let channels = null; // live channels near the truck (calls-directory), newest call first
  let channelsTriedAt = 0;
  let channelsLoading = false;
  let channelsError = '';
  const names = {}; // groupId -> short name, from the live list
  let callsBox = null; // the live-calls part of the open sheet, redrawn on its own

  const calls = createCallsPlayer({
    onStatus(text) {
      callsStatus = text;
      renderCallsLine();
    },
    onCall(call) {
      callsNow = call;
      renderCallsLine();
    },
    onError(message, fatal) {
      callsStatus = message;
      // A refused login or an empty balance stopped the player: the RADIO button goes dark.
      if (fatal) stopCalls();
      renderCallsLine();
      toast(message, 6000);
    },
  });

  function renderCallsLine() {
    if (!callsLine) return;
    callsLine.textContent = '';
    if (playingId !== 'calls') return;
    callsLine.appendChild(el('b', {}, callsNow ? names[callsNow.groupId] || groupName(callsNow.groupId) : 'Waiting for the first call'));
    callsLine.appendChild(el('span', {}, callsNow && callsNow.descr ? ` ${callsNow.descr} · ` : ' ') );
    callsLine.appendChild(el('span', {}, callsStatus));
  }

  function stopCalls() {
    calls.stop();
    callsNow = null;
    if (playingId === 'calls') {
      playingId = '';
      announce();
    }
  }

  /** pick: { id: 'pack:police' | 'group:<groupId>', groups: [groupId] } */
  function playCalls(pick) {
    const login = callsLogin(store, KEYS);
    if (!login.username || !login.password) {
      toast('Enter your Broadcastify login first.');
      return;
    }
    stopPage();
    stopMine();
    calls.start(pick.groups, { username: login.username, password: login.password });
    playingId = 'calls';
    store.callsPick = pick.id;
    saveStore(store);
    announce();
    openList(); // redraw with the status line and the lit pack
  }

  function announce() {
    onChange(playingId);
  }

  function stopPage() {
    if (native) native.radioClose();
    if (playingId && playingId !== 'mine') {
      playingId = '';
      announce();
    }
  }

  // The Android drawer reports its height (0 when closed) so the RECENTER pill and
  // toasts move up above it instead of hiding behind it.
  window.gevOnRadioLayout = (heightPx) => {
    document.documentElement.style.setProperty('--drawer', `${Math.max(0, Number(heightPx) || 0)}px`);
  };

  // The drawer's own STOP button (Android) ends the feed without the page asking.
  // Only a drawer feed is ended here: starting live calls, a station or my
  // scanner closes the drawer too, and its "closed" arrives after they start.
  const playsInPage = (id) => id === 'mine' || id === 'calls' || id.indexOf('station:') === 0;
  window.gevOnRadioClosed = () => {
    if (playingId && !playsInPage(playingId)) {
      playingId = '';
      announce();
    }
  };

  function stopMine() {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio = null;
    }
    if (playingId === 'mine' || playingId.indexOf('station:') === 0) {
      playingId = '';
      announce();
    }
  }

  function playMine() {
    const url = cleanStreamUrl(store.myScannerUrl);
    if (!url) {
      toast(store.myScannerUrl.trim() ? 'That address is not valid. It needs to start with http:// or https://.' : 'Enter your scanner stream address first.');
      return;
    }
    playStream(url, 'mine', 'My scanner');
  }

  /** One <audio> for anything that streams straight into the page: your scanner or a radio station. */
  function playStream(url, id, label) {
    stopPage();
    stopMine();
    stopCalls();
    audio = new Audio();
    trackPlayer(audio);
    audio.preload = 'none';
    // A hotspot drop ends or stalls the stream; try again a few seconds later,
    // forever, until the driver presses STOP (#56).
    const mine = audio;
    watchStream(audio, {
      retryMs: MY_SCANNER_RETRY_MS,
      stallMs: STREAM_STALL_MS,
      maxFailures: STREAM_MAX_FAILURES,
      isCurrent: () => playingId === id && audio === mine,
      restart: () => {
        mine.src = url;
        mine.play().catch(() => {});
      },
      onGiveUp: () => {
        if (playingId !== id || audio !== mine) return;
        toast('The stream kept dropping, so it stopped. Check the address or the hotspot, then press play again.', 7000);
        stopMine();
      },
    });
    audio.src = url;
    audio.play().catch((err) => {
      console.warn('stream:', err);
      toast('The stream did not start. Check the address and the hotspot.');
    });
    playingId = id;
    playingLabel = label;
    announce();
    closeSheet();
  }

  function stopAll() {
    stopPage();
    stopMine();
    stopCalls();
  }

  /** Reads the county the truck is in, then its live channels; redraws the sheet when they arrive. */
  function loadChannels() {
    if (channelsLoading || !hasCallsKeys()) return;
    channelsLoading = true;
    channelsTriedAt = Date.now();
    channelsError = '';
    fetchCounty(app.origin())
      .then((found) => {
        county = found;
        return fetchChannels(found.ctid);
      })
      .then(
        (list) => {
          channels = list;
          for (const c of list) names[c.groupId] = c.short;
        },
        (err) => {
          console.warn('channels:', err);
          channelsError = 'Could not load the live channels. Check the hotspot, then try again.';
        },
      )
      .then(() => {
        channelsLoading = false;
        refreshCallsBox();
      });
  }

  function loginFields(body) {
    if (callsLogin(store, KEYS).builtIn) return () => {};
    const user = el('input', { type: 'text', placeholder: 'Broadcastify username', value: store.bcfyUser, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const pass = el('input', { type: 'password', placeholder: 'Broadcastify password', value: store.bcfyPass });
    const remember = () => {
      store.bcfyUser = user.value.trim();
      store.bcfyPass = pass.value;
      saveStore(store);
    };
    user.addEventListener('change', remember);
    pass.addEventListener('change', remember);
    body.appendChild(el('div', { class: 'search-row' }, user));
    body.appendChild(el('div', { class: 'search-row' }, pass));
    body.appendChild(el('p', { class: 'sheet-sub' }, 'Your login stays on this unit.'));
    return remember;
  }

  /** Redraws only the live-calls part of the open sheet (the rest of the sheet is left alone). */
  function refreshCallsBox() {
    if (openSheetKind() !== 'radio' || !callsBox || !callsBox.parentNode) return;
    callsBox.textContent = '';
    fillCalls(callsBox);
  }

  function callsSection(body) {
    callsBox = el('div');
    body.appendChild(callsBox);
    fillCalls(callsBox);
  }

  // Everything plays inside the app through the Broadcastify Calls API: no web
  // pages, no sign-in screens. The list is read live, so only channels that are
  // actually talking show up (8 of the old 24 fixed channels were dead).
  function fillCalls(body) {
    const where = county ? ` · ${county.name.toUpperCase()} COUNTY` : '';
    body.appendChild(el('div', { class: 'section' }, el('h3', {}, `LIVE CALLS NEAR YOU${where}`)));
    if (!hasCallsKeys()) {
      body.appendChild(
        el(
          'p',
          { class: 'sheet-sub' },
          'Police and fire calls play inside this app through the Broadcastify Calls API ' +
            '(bcfy.io/dev, prepaid, from $5). Put the key id, secret and app id in keys.local.json and rebuild.',
        ),
      );
      return;
    }
    const remember = loginFields(body);
    callsLine = el('p', { class: 'calls-line' });
    body.appendChild(callsLine);
    renderCallsLine();
    if (!channels) {
      body.appendChild(el('p', { class: 'sheet-sub' }, channelsError || 'Finding channels with live calls near you...'));
      if (channelsError) {
        body.appendChild(
          el('button', { class: 'pill wide', onclick: () => { channelsTriedAt = 0; loadChannels(); refreshCallsBox(); } }, 'TRY AGAIN'),
        );
      }
      return;
    }
    const nowS = Math.floor(Date.now() / 1000);
    const list = channelList(channels, nowS);
    if (!list.length) {
      body.appendChild(el('p', { class: 'sheet-sub' }, 'No calls in this county in the last day. Try again later.'));
      return;
    }
    const row = el('div', { class: 'pack-row' });
    for (const pack of buildPacks(channels)) {
      const id = `pack:${pack.id}`;
      const button = el('button', { class: 'pill', onclick: () => { remember(); playCalls({ id, groups: pack.groups }); } }, pack.name.toUpperCase());
      if (playingId === 'calls' && store.callsPick === id) button.classList.add('on');
      row.appendChild(button);
    }
    body.appendChild(row);
    body.appendChild(el('p', { class: 'sheet-sub' }, 'Tap a group above, or one channel below. Newest calls first.'));
    for (const c of list) {
      const id = `group:${c.groupId}`;
      const live = nowS - c.lastTs <= LIVE_WINDOW_S;
      const button = el(
        'button',
        { class: live ? 'result' : 'result quiet', onclick: () => { remember(); playCalls({ id, groups: [c.groupId] }); } },
        el('b', {}, c.name),
        el('span', {}, [c.agency, c.type, `last call ${ageText(c.lastTs, nowS)}`].filter(Boolean).join(' · ')),
      );
      if (playingId === 'calls' && store.callsPick === id) button.classList.add('on');
      body.appendChild(button);
    }
  }

  // A station streams for as long as it plays, so LOW DATA switches it off.
  function playStation(st) {
    if (app.isLowData()) {
      toast('Low data is on, so radio stations are off to save your hotspot.');
      return;
    }
    playStream(st.url, `station:${st.id}`, st.name);
  }

  function stationsSection(body) {
    body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'RADIO STATIONS NEAR ME')));
    const holder = el('div');
    const load = el('button', { class: 'pill wide' }, 'SHOW ARIZONA STATIONS');
    load.addEventListener('click', () => {
      load.disabled = true;
      load.textContent = 'LOADING...';
      fetchStations().then(
        (rows) => {
          holder.textContent = '';
          const stations = sortStations(rows, app.origin());
          for (const st of stations) {
            const row = el(
              'button',
              { class: 'result', onclick: () => playStation(st) },
              el('b', {}, st.name),
              el('span', {}, [st.miles === null ? 'Arizona' : `${Math.round(st.miles)} mi`, st.tags, st.codec].filter(Boolean).join(' · ')),
            );
            if (playingId === `station:${st.id}`) row.classList.add('on');
            holder.appendChild(row);
          }
          load.hidden = true;
        },
        (err) => {
          console.warn('stations:', err);
          load.disabled = false;
          load.textContent = 'SHOW ARIZONA STATIONS';
          toast('Could not load the station list. Check the hotspot.');
        },
      );
    });
    body.appendChild(load);
    body.appendChild(holder);
    body.appendChild(el('p', { class: 'credits' }, 'Station directory: Radio Browser (public domain). Each stream comes straight from that broadcaster.'));
  }

  function openList() {
    const body = openSheet('radio', 'Radio', () => {
      callsLine = null;
    });
    if (!channelsLoading && Date.now() - channelsTriedAt > CHANNELS_RETRY_MS) loadChannels();

    if (playingId) {
      body.appendChild(
        el('button', { class: 'pill wide stop', onclick: () => { stopAll(); openList(); } }, 'STOP RADIO'),
      );
    }

    callsSection(body);
    stationsSection(body);

    body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'MY SCANNER')));
    const input = el('input', {
      type: 'url',
      placeholder: 'http://your-receiver:8000/stream.mp3',
      value: store.myScannerUrl,
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
    });
    input.addEventListener('change', () => {
      store.myScannerUrl = input.value.trim();
      saveStore(store);
    });
    const play = el('button', { class: 'pill small', onclick: () => { store.myScannerUrl = input.value.trim(); saveStore(store); playMine(); } }, 'PLAY');
    if (playingId === 'mine') play.classList.add('on');
    body.appendChild(el('div', { class: 'search-row' }, input, play));
    body.appendChild(
      el('p', { class: 'sheet-sub' }, 'Your own RTL-SDR receiver streaming MP3 over the hotspot. Plays right here.'),
    );

    body.appendChild(
      el(
        'p',
        { class: 'credits' },
        'Live calls: Broadcastify Calls, recorded by volunteer receivers and played here through their licensed API. ' +
          'Encrypted channels cannot be heard anywhere. Listening is legal in Arizona; using what you hear to commit a crime is not.',
      ),
    );
  }

  return {
    openList,
    stopAll,
    isPlaying: () => !!playingId,
    /** LOW DATA switched on: a playing radio station stops (your own scanner keeps going). */
    onLowData(on) {
      if (on && playingId.indexOf('station:') === 0) {
        stopMine();
        toast('Low data is on: the radio station stopped.');
      }
    },
    /** Called with the playing feed id ('' when silent) whenever it changes. */
    onChange(fn) {
      onChange = fn;
    },
  };
}
