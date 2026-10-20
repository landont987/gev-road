// Road info from AZ511 (your key): closures and crashes, highway message signs,
// weather stations and rest areas. Which rows matter, whether a closure is on
// right now, and which pop-up cards are due as the truck moves.
// Pure: no DOM, no timers, no network.

import { distanceM, bearingDeg } from './geo.js';
import { angleDiff, spokenPlace } from './alert-logic.js';

// How far ahead each kind pops up. Closures come early so there is time to exit.
const RULES = {
  closure: { withinM: 5000, speak: true },
  crash: { withinM: 4000, speak: true },
  sign: { withinM: 2000, speak: false },
  weather: { withinM: 2500, speak: false },
  rest: { withinM: 8000, speak: false },
};
const AHEAD_CONE_DEG = 45;
const SAME_DIRECTION_DEG = 70; // a "Northbound" row counts when the truck heads within this of north
const HEADING_MIN_SPEED_MPS = 1;
const NO_HEADING_M = 300; // parked or crawling: only a spot this close counts
const REARM_EXTRA_M = 3000; // a card can show again once the truck is this far past its range
const MAX_PER_FIX = 2;
const WINDY_MPH = 40; // gusts this strong at a weather station are spoken
const ARIZONA_OFFSET_MIN = -7 * 60; // Arizona never changes its clocks

const DIRECTION_DEG = { N: 0, E: 90, S: 180, W: 270 };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Northbound", "North", "SB", "(EB)" -> degrees; null when the row has no single direction. */
export function directionDeg(text) {
  const t = String(text || '').trim();
  const word = /^(North|East|South|West)(bound)?$/i.exec(t);
  if (word) return DIRECTION_DEG[word[1][0].toUpperCase()];
  const short = /\(?\b([NESW])B\b\)?/.exec(t);
  return short ? DIRECTION_DEG[short[1]] : null;
}

/** "8/4/2025 5:00:00 AM-07:00:00" -> ms. Only the formats AZ511 sends. */
function parseScheduleDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)/.exec(String(text || ''));
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[7] === 'PM') hour += 12;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6])) - ARIZONA_OFFSET_MIN * 60000;
}

/** "21:30:00-07:00:00" -> minutes after midnight, Arizona time. */
function minutesOfDay(text) {
  const m = /^(\d{2}):(\d{2})/.exec(String(text || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Is this event in force at nowMs? Uses its weekly schedule when it has one
 * ("FRI 9PM TO MON 5AM" closures are only on during those hours), otherwise
 * its start and planned end.
 */
export function isActiveNow(event, nowMs) {
  const schedules = Array.isArray(event.RecurrenceSchedules) ? event.RecurrenceSchedules : [];
  if (schedules.length) {
    const local = new Date(nowMs + ARIZONA_OFFSET_MIN * 60000);
    const day = DAYS[local.getUTCDay()];
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    return schedules.some((s) => {
      const from = parseScheduleDate(s.StartDate);
      const to = parseScheduleDate(s.EndDate);
      if (from === null || nowMs < from || (to !== null && nowMs > to)) return false;
      if (Array.isArray(s.DaysOfWeek) && s.DaysOfWeek.length && s.DaysOfWeek.indexOf(day) < 0) return false;
      const times = Array.isArray(s.Times) ? s.Times : [];
      if (!times.length) return true;
      return times.some((t) => {
        const a = minutesOfDay(t.StartTime);
        const b = minutesOfDay(t.EndTime);
        if (a === null || b === null) return true;
        return a <= b ? minute >= a && minute <= b : minute >= a || minute <= b; // overnight window
      });
    });
  }
  const start = Number(event.StartDate) * 1000;
  const end = event.PlannedEndDate ? Number(event.PlannedEndDate) * 1000 : Infinity;
  return (!start || start <= nowMs) && nowMs <= end;
}

const SWEEPERS = /WATCH FOR SWEEPERS/i;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const number = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const hasSpot = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

/** Closures (all lanes) and crashes that are on right now. Road work that leaves a lane open is left out. */
export function parseEvents(rows, nowMs) {
  const spots = [];
  for (const e of Array.isArray(rows) ? rows : []) {
    if (!e) continue;
    const lat = number(e.Latitude);
    const lon = number(e.Longitude);
    if (!hasSpot(lat, lon)) continue;
    const isCrash = e.EventType === 'accidentsAndIncidents';
    if (!isCrash && !e.IsFullClosure) continue;
    if (!isActiveNow(e, nowMs)) continue;
    const description = clean(e.Description);
    const sweeper = SWEEPERS.test(description) || e.EventSubType === 'TSWEEP';
    const title = isCrash ? crashTitle(e.EventSubType) : closureTitle(e.EventSubType);
    spots.push({
      id: `event:${e.ID}`,
      kind: isCrash ? 'crash' : 'closure',
      lat,
      lon,
      road: clean(e.RoadwayName),
      directionDeg: directionDeg(e.DirectionOfTravel),
      title,
      text: description,
      major: String(e.Severity || '').toLowerCase() === 'major',
      // A closed on-ramp only matters to someone on that street, so its card stays silent.
      speak: !sweeper && title !== 'ON-RAMP CLOSED',
    });
  }
  return spots;
}

function crashTitle(sub) {
  const s = String(sub || '').toLowerCase();
  if (s.indexOf('fire') >= 0) return 'VEHICLE FIRE';
  if (s.indexOf('sweep') >= 0) return 'SWEEPERS';
  if (s.indexOf('disabled') >= 0 || s.indexOf('stall') >= 0) return 'STALLED VEHICLE';
  if (s.indexOf('debris') >= 0) return 'DEBRIS';
  return 'CRASH';
}

function closureTitle(sub) {
  const s = String(sub || '').toLowerCase();
  if (s.indexOf('freeway') >= 0) return 'FREEWAY CLOSED';
  if (s.indexOf('onramp') >= 0) return 'ON-RAMP CLOSED';
  if (s.indexOf('exit') >= 0 || s.indexOf('offramp') >= 0) return 'EXIT CLOSED';
  if (s.indexOf('ramp') >= 0) return 'RAMP CLOSED';
  if (s.indexOf('parade') >= 0 || s.indexOf('cycling') >= 0 || s.indexOf('event') >= 0) return 'EVENT CLOSURE';
  return 'ROAD CLOSED';
}

/** Signs with a real message: blank signs and "watch for sweepers" are left out. */
export function parseSigns(rows) {
  const spots = [];
  for (const s of Array.isArray(rows) ? rows : []) {
    if (!s) continue;
    const lat = number(s.Latitude);
    const lon = number(s.Longitude);
    if (!hasSpot(lat, lon)) continue;
    const pages = (Array.isArray(s.Messages) ? s.Messages : [])
      .map((m) => String(m || '').replace(/\r/g, '').trim())
      .filter((m) => m && m !== 'NO_MESSAGE' && !SWEEPERS.test(m));
    if (!pages.length) continue;
    spots.push({
      id: `sign:${s.Id}`,
      kind: 'sign',
      lat,
      lon,
      road: clean(s.Roadway),
      directionDeg: directionDeg(s.DirectionOfTravel),
      title: clean(s.Name),
      pages,
    });
  }
  return spots;
}

export function parseWeather(rows) {
  const spots = [];
  for (const w of Array.isArray(rows) ? rows : []) {
    if (!w) continue;
    const lat = number(w.Latitude);
    const lon = number(w.Longitude);
    if (!hasSpot(lat, lon)) continue;
    const air = number(w.AirTemperature);
    const road = number(w.SurfaceTemperature);
    const wind = number(w.WindSpeed);
    const gust = number(w.MaxWindSpeed);
    const grip = clean(w.LevelOfGrip);
    const parts = [];
    if (air !== null) parts.push(`${Math.round(air)}°F air`);
    if (road !== null) parts.push(`road ${Math.round(road)}°F`);
    if (wind !== null) parts.push(`wind ${Math.round(wind)} mph ${clean(w.WindDirection)}`.trim());
    if (gust !== null) parts.push(`gusts ${Math.round(gust)}`);
    if (grip) parts.push(`grip ${grip.toLowerCase()}`);
    const windy = gust !== null && gust >= WINDY_MPH;
    const slick = !!grip && grip.toLowerCase() !== 'good';
    spots.push({
      id: `weather:${w.Id}`,
      kind: 'weather',
      lat,
      lon,
      directionDeg: null,
      title: windy ? 'HIGH WIND' : slick ? 'SLICK ROAD' : 'ROAD WEATHER',
      text: parts.join(' · '),
      speak: windy || slick,
      spoken: windy ? `High wind ahead, gusts ${Math.round(gust)} miles per hour.` : slick ? `Road grip is ${grip.toLowerCase()} ahead.` : '',
    });
  }
  return spots;
}

export function parseRestAreas(rows) {
  const spots = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const lat = number(r.Latitude);
    const lon = number(r.Longitude);
    if (!hasSpot(lat, lon)) continue;
    const open = clean(r.Status).toLowerCase() === 'open';
    const parts = [open ? 'Open' : `Status: ${clean(r.Status) || 'unknown'}`];
    if (clean(r.Restroom).toLowerCase() === 'yes') parts.push('restrooms');
    const free = number(r.AvailableTruckSpaces);
    const total = number(r.TotalTruckSpaces);
    if (free !== null && total) parts.push(`${free} of ${total} truck spots open`);
    spots.push({
      id: `rest:${r.Id}`,
      kind: 'rest',
      lat,
      lon,
      directionDeg: directionDeg(r.Name),
      title: clean(r.Name) || 'REST AREA',
      text: [clean(r.Location), parts.join(' · ')].filter(Boolean).join(' · '),
    });
  }
  return spots;
}

function hasHeading(fix) {
  return fix.bearing !== null && fix.bearing !== undefined && fix.speed !== null && fix.speed !== undefined && fix.speed >= HEADING_MIN_SPEED_MPS;
}

/** Ahead of the truck, and (when the row has one) for the direction it is driving. */
function isAheadForUs(fix, spot, d) {
  if (!hasHeading(fix)) return d <= NO_HEADING_M;
  if (angleDiff(bearingDeg(fix, spot), fix.bearing) > AHEAD_CONE_DEG) return false;
  if (spot.directionDeg !== null && spot.directionDeg !== undefined && angleDiff(spot.directionDeg, fix.bearing) > SAME_DIRECTION_DEG) return false;
  return true;
}

const MILES_PER_M = 1 / 1609.344;

/** "0.4 mi" / "3 mi" for the card. */
export function milesText(m) {
  const mi = m * MILES_PER_M;
  return mi < 1 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

function spokenMiles(m) {
  const mi = m * MILES_PER_M;
  if (mi < 0.75) return 'under a mile';
  const n = Math.round(mi);
  return n === 1 ? 'in 1 mile' : `in ${n} miles`;
}

/** What the voice says for a card, or '' to stay silent. */
export function spokenLine(spot, d) {
  if (spot.kind === 'closure' && spot.speak) {
    const what = spot.title === 'EVENT CLOSURE' ? 'Event closure' : spot.title.charAt(0) + spot.title.slice(1).toLowerCase();
    const road = spot.road ? ` on ${spokenPlace(spot.road)}` : '';
    return `${what} ahead${road}, ${spokenMiles(d)}.`;
  }
  if (spot.kind === 'crash' && spot.speak) {
    const what = spot.title.charAt(0) + spot.title.slice(1).toLowerCase();
    const road = spot.road ? ` on ${spokenPlace(spot.road)}` : '';
    return `${what} ahead${road}, ${spokenMiles(d)}.`;
  }
  if (spot.kind === 'weather' && spot.speak) return spot.spoken;
  return '';
}

/**
 * spots: every road-info spot; fix: { lat, lon, bearing|null, speed|null };
 * shown: { id: true } from the last call (start with {}).
 * Returns the cards due now (closures and crashes first, then nearest) and the next `shown`.
 */
export function dueCards(spots, fix, shown) {
  const nextShown = Object.assign({}, shown);
  const due = [];
  for (const spot of spots) {
    const rule = RULES[spot.kind];
    if (!rule) continue;
    const d = distanceM(fix, spot);
    if (nextShown[spot.id]) {
      if (d > rule.withinM + REARM_EXTRA_M) delete nextShown[spot.id];
      continue;
    }
    if (d > rule.withinM || !isAheadForUs(fix, spot, d)) continue;
    due.push({ spot, d });
  }
  const urgent = (s) => (s.kind === 'closure' || s.kind === 'crash' ? 0 : 1);
  due.sort((a, b) => urgent(a.spot) - urgent(b.spot) || a.d - b.d);
  const cards = due.slice(0, MAX_PER_FIX).map(({ spot, d }) => {
    nextShown[spot.id] = true;
    return { spot, distanceText: milesText(d), say: spokenLine(spot, d) };
  });
  return { cards, shown: nextShown };
}
