// RADIO: police, fire and highway patrol you can listen to while driving.
//
// Two ways to hear something:
//  1. A public feed (Broadcastify or OpenMHz). Their pages are opened as-is in
//     the truck's radio drawer (a second WebView the Android app owns), or in a
//     new tab on a computer. The audio stays on their page; the app never
//     relays it. That is the one way both sites allow.
//  2. MY SCANNER: a stream from your own receiver (an RTL-SDR box running
//     trunk-recorder, SDRTrunk or OP25 that streams MP3 over the hotspot).
//     That audio is yours, so it plays right here in the page.

import { FEEDS, feedUrl, feedSource, BROADCASTIFY_COUNTY_URL } from './radio-feeds.js';
import { fetchCounty, fetchStations, sortStations } from './stations.js';
import { CALL_PACKS, groupName } from './calls-groups.js';
import { createCallsPlayer, hasCallsKeys } from './calls.js';
import { distanceM } from './geo.js';
import { el, openSheet, closeSheet, toast } from './ui.js';
import { trackPlayer } from './audio-duck.js';

const STORE_KEY = 'gev-road-radio';
const MY_SCANNER_RETRY_MS = 4000;
const M_PER_MILE = 1609.344;

function loadStore() {
  try {
    return Object.assign(
      { lastFeedId: '', myScannerUrl: '', bcfyUser: '', bcfyPass: '', callsPack: '' },
      JSON.parse(localStorage.getItem(STORE_KEY) || '{}'),
    );
  } catch (err) {
    return { lastFeedId: '', myScannerUrl: '', bcfyUser: '', bcfyPass: '', callsPack: '' };
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
  let audioRetry = null;
  let playingId = ''; // feed id, 'mine', 'calls' or 'station:<id>'
  let playingLabel = '';
  let county = null; // { ctid, name } for the truck's position
  let onChange = () => {};
  let callsStatus = ''; // "signing in", "listening", "2 waiting"
  let callsNow = null; // the call playing right now
  let callsLine = null; // status element in the open sheet, when it is open

  const calls = createCallsPlayer({
    onStatus(text) {
      callsStatus = text;
      renderCallsLine();
    },
    onCall(call) {
      callsNow = call;
      renderCallsLine();
    },
    onError(message) {
      callsStatus = message;
      renderCallsLine();
      toast(message, 6000);
    },
  });

  function renderCallsLine() {
    if (!callsLine) return;
    callsLine.textContent = '';
    if (playingId !== 'calls') return;
    callsLine.appendChild(el('b', {}, callsNow ? `${groupName(callsNow.groupId)}` : 'Waiting for the first call'));
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

  function playCalls(pack) {
    if (!store.bcfyUser || !store.bcfyPass) {
      toast('Enter your Broadcastify login first.');
      return;
    }
    stopPage();
    stopMine();
    calls.start(pack.groups, { username: store.bcfyUser, password: store.bcfyPass });
    playingId = 'calls';
    store.callsPack = pack.id;
    saveStore(store);
    announce();
    openList(); // redraw with the status line and the lit pack
  }

  function announce() {
    onChange(playingId);
  }

  function openPage(feed) {
    const url = feed.pageUrl || feedUrl(feed);
    stopMine();
    stopCalls();
    if (native) {
      native.radioOpen(url, feed.name);
    } else {
      // Computer preview: a tab is the closest thing to the truck's drawer.
      const win = window.open(url, '_blank', 'noopener');
      if (!win) {
        toast('The browser blocked the tab. Allow pop-ups for this page.');
        return;
      }
    }
    playingId = feed.id;
    store.lastFeedId = feed.id;
    saveStore(store);
    announce();
    closeSheet();
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
    clearTimeout(audioRetry);
    audioRetry = null;
    if (audio) {
      audio.onerror = null;
      audio.onplaying = null;
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
    audio.onplaying = () => {
      clearTimeout(audioRetry);
      audioRetry = null;
    };
    // A hotspot drop ends the stream; try again a few seconds later, forever,
    // until the driver presses STOP.
    audio.onerror = () => {
      if (audioRetry || playingId !== id) return;
      audioRetry = setTimeout(() => {
        audioRetry = null;
        if (playingId === id && audio) {
          audio.src = url;
          audio.play().catch(() => {});
        }
      }, MY_SCANNER_RETRY_MS);
    };
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

  function callsSection(body) {
    body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'LIVE CALLS, PLAYED HERE')));
    if (!hasCallsKeys()) {
      body.appendChild(
        el(
          'p',
          { class: 'sheet-sub' },
          'Phoenix Police, Phoenix Fire and DPS calls can play inside this app through the Broadcastify Calls API ' +
            '(bcfy.io/dev, prepaid, from $5). Put the key id, secret and app id in keys.local.json and rebuild.',
        ),
      );
      return;
    }
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
    body.appendChild(el('p', { class: 'sheet-sub' }, 'Your login stays on this unit. Calls are a few seconds behind live and metered to your prepaid balance.'));
    callsLine = el('p', { class: 'calls-line' });
    body.appendChild(callsLine);
    renderCallsLine();
    for (const pack of CALL_PACKS) {
      const button = el(
        'button',
        { class: 'result', onclick: () => { remember(); playCalls(pack); } },
        el('b', {}, pack.name),
        el('span', {}, pack.groups.map(groupName).join(' · ')),
      );
      if (playingId === 'calls' && store.callsPack === pack.id) button.classList.add('on');
      body.appendChild(button);
    }
  }

  function countySection(body) {
    body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'EVERY FEED IN THIS COUNTY')));
    const button = el('button', { class: 'pill wide' }, county ? `ALL ${county.name.toUpperCase()} COUNTY FEEDS` : 'FINDING YOUR COUNTY...');
    button.disabled = !county;
    button.addEventListener('click', () => {
      if (!county) return;
      openPage({ id: `county-${county.ctid}`, kind: 'broadcastify', feed: county.ctid, name: `${county.name} County feeds`, pageUrl: `${BROADCASTIFY_COUNTY_URL}${county.ctid}` });
    });
    body.appendChild(button);
    body.appendChild(
      el(
        'p',
        { class: 'sheet-sub' },
        "Broadcastify's full list for the county you are in: police, fire, ham repeaters, GMRS, rail, weather, with who is online and how many are listening. Pick one on their page.",
      ),
    );
    if (!county) {
      fetchCounty(app.origin()).then((found) => {
        county = found;
        button.textContent = `ALL ${found.name.toUpperCase()} COUNTY FEEDS`;
        button.disabled = false;
      });
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

  function feedRow(entry) {
    const feed = entry.feed;
    const miles = Math.round(entry.miles);
    const button = el(
      'button',
      { class: 'result', onclick: () => openPage(feed) },
      el('b', {}, feed.name),
      el('span', {}, `${feed.group} · ${miles} mi · ${feedSource(feed)}`),
      feed.note ? el('span', { class: 'result-note' }, feed.note) : null,
    );
    if (playingId === feed.id) button.classList.add('on');
    return button;
  }

  function openList() {
    const body = openSheet('radio', 'Radio', () => {
      callsLine = null;
    });

    if (playingId) {
      body.appendChild(
        el('button', { class: 'pill wide stop', onclick: () => { stopAll(); openList(); } }, 'STOP RADIO'),
      );
    }

    callsSection(body);

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
      el('p', { class: 'sheet-sub' }, 'Your own RTL-SDR receiver streaming MP3 over the hotspot. Plays right here, no page needed.'),
    );

    body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'LIVE PUBLIC SAFETY FEEDS, NEAREST FIRST')));
    body.appendChild(
      el(
        'p',
        { class: 'sheet-sub' },
        native
          ? 'Opens the feed page in the radio drawer. Press play on it; it keeps playing while you drive.'
          : 'Opens the feed page in a new tab (on the truck it opens in the radio drawer).',
      ),
    );
    for (const entry of sortFeedsByDistance(FEEDS, app.origin())) body.appendChild(feedRow(entry));

    countySection(body);
    stationsSection(body);

    body.appendChild(
      el(
        'p',
        { class: 'credits' },
        'Feeds are volunteer receivers on Broadcastify and OpenMHz; their pages carry their own ads and terms. ' +
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
