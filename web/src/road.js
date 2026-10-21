// Road info from AZ511 (needs your key): closures and crashes, highway message
// signs, weather stations and rest areas. Each shows as a dot, and a card slides
// in by itself as the truck gets close (closures and crashes also speak), so
// nothing needs a tap while driving. road-logic.js decides what is due.
//
// AZ511 sends no CORS header, so on the truck the Android app makes these
// requests (nativeFetch). The closures list is about 2.4 MB of JSON but
// travels gzipped, about 280 KB.

import { KEYS } from './config.js';
import { nativeFetch } from './native-fetch.js';
import { parseEvents, parseSigns, parseWeather, parseRestAreas, dueCards, milesText, stillDueM } from './road-logic.js';
import { $, el } from './ui.js';
import { distanceM } from './geo.js';
import { createDotLayer } from './dots.js';

const API = 'https://az511.com/api/v2/get/';
const MIN = 60 * 1000;
// How often each list is fetched again; low data mode waits longer for the big one.
const FEEDS = {
  event: { everyMs: 5 * MIN, lowDataEveryMs: 15 * MIN, parse: (rows) => parseEvents(rows, Date.now()) },
  messagesigns: { everyMs: 3 * MIN, lowDataEveryMs: 10 * MIN, parse: parseSigns },
  weatherstations: { everyMs: 10 * MIN, lowDataEveryMs: 30 * MIN, parse: parseWeather },
  restareas: { everyMs: 30 * MIN, lowDataEveryMs: 60 * MIN, parse: parseRestAreas },
};
const RETRY_MS = 2 * MIN;
const TICK_MS = 30 * 1000;
const TIMEOUT_MS = 45000;
const CARD_MS = { urgent: 10000, other: 7000, signPage: 3000 };
const SLIDE_MS = 300; // matches the transition in style.css

/** deps: { map, voice, settings, app, getFix() } */
export function createRoad(deps) {
  const { map, voice, settings, app } = deps;
  const dots = createDotLayer(map);
  const lists = {}; // feed -> spots
  const fetchedAt = {}; // feed -> ms of the last try
  const loading = {};
  let spots = [];
  let shown = {};
  let enabled = false;

  // ---- data ----
  function rebuild() {
    spots = [].concat(...Object.keys(lists).map((k) => lists[k]));
    dots.setSpots(spots.map((spot) => ({ lat: spot.lat, lon: spot.lon, kind: spot.kind, onTap: () => tapped(spot) })));
  }

  function load(feed) {
    loading[feed] = true;
    fetchedAt[feed] = Date.now();
    return nativeFetch(`${API}${feed}?format=json&key=${encodeURIComponent(KEYS.az511)}`, TIMEOUT_MS)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((rows) => {
        lists[feed] = FEEDS[feed].parse(rows);
        rebuild();
      })
      .catch((err) => {
        // Keep the last good list; try again sooner than the normal wait.
        fetchedAt[feed] = Date.now() - (FEEDS[feed].everyMs - RETRY_MS);
        console.warn(`road info ${feed}:`, err.message || err);
      })
      .then(() => {
        loading[feed] = false;
      });
  }

  function tick() {
    if (!enabled || !KEYS.az511) return;
    for (const feed of Object.keys(FEEDS)) {
      const wait = app.isLowData() ? FEEDS[feed].lowDataEveryMs : FEEDS[feed].everyMs;
      if (!loading[feed] && (!fetchedAt[feed] || Date.now() - fetchedAt[feed] >= wait)) load(feed);
    }
  }
  setInterval(tick, TICK_MS);

  // ---- the card ----
  const queue = [];
  let showing = null; // { card, timer, pageTimer }

  function cardNode(spot, distanceText) {
    const head = el(
      'div',
      { class: 'pop-head' },
      el('span', { class: 'pop-title' }, spot.kind === 'sign' ? 'HIGHWAY SIGN' : spot.title),
      distanceText ? el('span', { class: 'pop-dist' }, distanceText) : null,
    );
    if (spot.kind === 'sign') {
      const board = el('div', { class: 'pop-board' }, spot.pages[0]);
      return { nodes: [head, board, el('div', { class: 'pop-sub' }, spot.title)], board };
    }
    const nodes = [head, el('div', { class: 'pop-text' }, spot.text || '')];
    if (spot.road && spot.kind !== 'sign') nodes.push(el('div', { class: 'pop-sub' }, spot.road));
    return { nodes };
  }

  /** The next queued card still worth showing, with its distance from where the truck is now. */
  function nextCard() {
    const fix = deps.getFix();
    while (queue.length) {
      const entry = queue.shift();
      if (entry.tapped || !fix) return entry;
      const d = stillDueM(entry.spot, fix);
      if (d !== null) return { spot: entry.spot, distanceText: milesText(d) };
    }
    return null;
  }

  function showNext() {
    if (showing || !queue.length) return;
    const next = nextCard();
    if (!next) return;
    const { spot, distanceText } = next;
    const box = $('popup');
    box.textContent = '';
    box.className = `pop pop-${spot.kind}`;
    const { nodes, board } = cardNode(spot, distanceText);
    nodes.forEach((n) => box.appendChild(n));
    box.hidden = false;
    void box.offsetWidth; // start the slide from off screen
    box.classList.add('in');
    let pageTimer = null;
    if (board && spot.pages.length > 1) {
      let page = 0;
      pageTimer = setInterval(() => {
        page = (page + 1) % spot.pages.length;
        board.textContent = spot.pages[page];
      }, CARD_MS.signPage);
    }
    const urgent = spot.kind === 'closure' || spot.kind === 'crash';
    const ms = spot.kind === 'sign' ? Math.max(CARD_MS.other, spot.pages.length * CARD_MS.signPage * 2) : urgent ? CARD_MS.urgent : CARD_MS.other;
    showing = { urgent, leaving: false, pageTimer, timer: setTimeout(hide, ms) };
  }

  function hide() {
    if (!showing || showing.leaving) return;
    showing.leaving = true;
    clearTimeout(showing.timer);
    clearInterval(showing.pageTimer);
    const box = $('popup');
    box.classList.remove('in');
    setTimeout(() => {
      box.hidden = true;
      showing = null;
      showNext();
    }, SLIDE_MS);
  }
  $('popup').addEventListener('click', hide);

  /** urgent: closures and crashes go first and slide a quieter card away. */
  function push(spot, distanceText, urgent) {
    if (urgent) queue.unshift({ spot, distanceText });
    else queue.push({ spot, distanceText });
    if (showing && urgent && !showing.urgent) hide();
    else showNext();
  }

  function tapped(spot) {
    const fix = deps.getFix();
    // A tap replaces whatever is showing or waiting.
    queue.length = 0;
    queue.push({ spot, distanceText: fix ? milesText(distanceM(fix, spot)) : '', tapped: true });
    if (showing) hide();
    else showNext();
  }

  return {
    /** How many dots are DOM markers right now (the menu's SCREEN line, #65). */
    count: dots.count,
    hasKey: () => !!KEYS.az511,
    setEnabled(on) {
      enabled = on && !!KEYS.az511;
      dots.setEnabled(enabled);
      if (enabled) {
        tick();
      } else {
        queue.length = 0;
        hide();
      }
    },
    onFix(fix) {
      if (!enabled || !spots.length) return;
      const result = dueCards(spots, fix, shown);
      shown = result.shown;
      for (const card of result.cards) {
        const urgent = card.spot.kind === 'closure' || card.spot.kind === 'crash';
        push(card.spot, card.distanceText, urgent);
        if (card.say) voice.alert('road', card.say);
      }
    },
  };
}
