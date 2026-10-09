// Engine data in the status box ("ENGINE 198°F · 14.2 V") and the spoken
// "Engine running hot". The readings come from the separate AndrOBD app on the
// head unit, through the Android app (AndrobdPlugin, EngineDataService) into
// window.gevOnEngine(kind, text); GEV Road has none of AndrOBD's code.

import { $ } from './ui.js';
import {
  parseData,
  parseList,
  heard,
  applyData,
  applyList,
  engineText,
  engineStatus,
  isHot,
  shouldWarn,
  COOLANT_KEY,
  SETTLE_MS,
  HOT_TEXT,
} from './engine-logic.js';

function savedList() {
  if (!window.GevNative || typeof window.GevNative.engineList !== 'function') return '';
  return String(window.GevNative.engineList() || '');
}

/** deps: { voice } */
export function createEngine(deps) {
  const { voice } = deps;
  let reading = null; // { coolantC, volts, heardAt }
  let list = parseList(savedList()); // which items AndrOBD reads, and its coolant units
  let warnedAt = -Infinity;
  let waiting = null; // { item, timer }: a coolant reading waiting SETTLE_MS for a units text

  function paint() {
    const now = Date.now();
    if (shouldWarn(reading, warnedAt, now)) {
      warnedAt = now;
      voice.alert('engine', HOT_TEXT);
    }
    const box = $('engine');
    if (!box) return;
    const text = engineText(reading, now);
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('hot', isHot(reading, now));
  }

  /** Counts the waiting coolant reading, in the units known now. */
  function settle() {
    if (!waiting) return;
    clearTimeout(waiting.timer);
    reading = applyData(reading, waiting.item, list.coolantUnits, Date.now());
    waiting = null;
    paint();
  }

  function onData(text) {
    reading = heard(reading, Date.now());
    const item = parseData(text);
    if (!item) return;
    if (item.units) {
      // AndrOBD's units changed: the reading just before was already in them.
      list = Object.assign({}, list, { coolantUnits: item.units });
      settle();
      return;
    }
    if (item.key === COOLANT_KEY) {
      settle(); // no units text came after the one before
      waiting = { item, timer: setTimeout(settle, SETTLE_MS) };
      return;
    }
    reading = applyData(reading, item, list.coolantUnits, Date.now());
    paint();
  }

  window.gevOnEngine = (kind, text) => {
    try {
      if (kind === 'list') {
        list = parseList(text);
        reading = applyList(reading, list);
      } else if (kind === 'data') {
        onData(text);
      } else if (kind === 'beat') {
        reading = heard(reading, Date.now());
      }
    } catch (err) {
      console.warn('engine data:', err);
    }
  };

  return {
    /** Called every few seconds: data that stopped coming disappears, and a hot engine is said again. */
    paint,
    status: () => engineStatus(reading, list, Date.now()),
    list: () => list,
  };
}
