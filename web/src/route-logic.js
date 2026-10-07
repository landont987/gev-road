// Directions logic: OSRM response -> route, spoken-style instruction text,
// and progress along the route for a GPS fix. Pure, so it runs under node:test.

import { cumulativeM, projectOntoLine } from './geo.js';

// "I 17" -> "I-17", the way the signs read.
const SHIELD = /\b(I|US|SR|AZ|Loop) (\d+)/g;

/** "I 17; US 60" -> "I-17 / US-60". */
export function formatRef(ref) {
  if (!ref) return '';
  return ref
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean)
    .join(' / ')
    .replace(SHIELD, '$1-$2');
}

function roadName(step) {
  const ref = formatRef(step.ref);
  if (step.name && ref) return `${step.name} (${ref})`;
  return step.name || ref || '';
}

function toward(step) {
  return step.destinations ? ` toward ${step.destinations.replace(SHIELD, '$1-$2')}` : '';
}

const SIDE = {
  left: 'left',
  right: 'right',
  'slight left': 'left',
  'slight right': 'right',
  'sharp left': 'left',
  'sharp right': 'right',
};

function turnText(modifier) {
  if (modifier === 'uturn') return 'Make a U-turn';
  if (modifier === 'straight') return 'Go straight';
  const side = SIDE[modifier] || modifier;
  if (modifier.startsWith('slight')) return `Bear ${side}`;
  if (modifier.startsWith('sharp')) return `Turn sharp ${side}`;
  return `Turn ${side}`;
}

/** Plain-English instruction for one OSRM step. */
export function instructionFor(step) {
  const m = step.maneuver || {};
  const road = roadName(step);
  const onto = road ? ` onto ${road}` : '';
  switch (m.type) {
    case 'depart':
      return road ? `Start on ${road}` : 'Start driving';
    case 'arrive':
      return 'Arrive at your destination';
    case 'turn':
    case 'end of road':
      return `${turnText(m.modifier || 'straight')}${m.modifier === 'uturn' ? '' : onto}`;
    case 'on ramp':
      return `Take the ramp${toward(step) || onto}`;
    case 'off ramp':
      return `Take exit${step.exits ? ' ' + step.exits : ''}${toward(step) || onto}`;
    case 'fork':
      return `Keep ${SIDE[m.modifier] || 'straight'}${toward(step) || onto}`;
    case 'merge':
      return `Merge${onto}`;
    case 'roundabout':
    case 'rotary':
      return m.exit ? `At the roundabout, take exit ${m.exit}${onto}` : `Enter the roundabout${onto}`;
    default:
      return road ? `Continue onto ${road}` : 'Continue';
  }
}

/** OSRM /route JSON -> { coords, cum, scale, distanceM, durationS, steps }. Throws on a bad answer. */
export function parseRoute(json) {
  if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) {
    throw new Error((json && json.message) || 'No route found');
  }
  const r = json.routes[0];
  const coords = r.geometry.coordinates;
  const cum = cumulativeM(coords);
  const geomLength = cum[cum.length - 1] || 1;
  let along = 0;
  const steps = r.legs[0].steps.map((s) => {
    const step = {
      text: instructionFor(s),
      type: s.maneuver.type,
      modifier: s.maneuver.modifier || '',
      atM: along,
      distanceM: s.distance,
    };
    along += s.distance;
    return step;
  });
  return {
    coords,
    cum,
    // OSRM step distances and our haversine geometry differ slightly; scale
    // snapped positions into OSRM's units so they line up with step.atM.
    scale: r.distance / geomLength,
    distanceM: r.distance,
    durationS: r.duration,
    steps,
  };
}

/**
 * Where a GPS fix sits on the route: the next maneuver, the distance to it,
 * what is left, and how far off the route line the truck is.
 */
export function routeProgress(route, pos) {
  const snap = projectOntoLine(pos, route.coords, route.cum);
  const alongM = snap.alongM * route.scale;
  let next = route.steps[route.steps.length - 1];
  for (let i = 1; i < route.steps.length; i++) {
    if (route.steps[i].atM > alongM + 5) {
      next = route.steps[i];
      break;
    }
  }
  const remainingM = Math.max(0, route.distanceM - alongM);
  return {
    next,
    toNextM: Math.max(0, next.atM - alongM),
    remainingM,
    remainingS: route.distanceM > 0 ? (route.durationS * remainingM) / route.distanceM : 0,
    offM: snap.offM,
    arrived: remainingM < 30,
  };
}

/** Driver-friendly distance: feet under a tenth of a mile, otherwise miles. */
export function formatDistance(m) {
  const miles = m / 1609.344;
  if (miles < 0.1) return `${Math.max(0, Math.round((m * 3.28084) / 50) * 50)} ft`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export function formatDuration(s) {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
