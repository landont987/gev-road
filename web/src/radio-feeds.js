// Public safety radio you can listen to around Phoenix and Tucson.
// Every feed id and system name below was read from the live Broadcastify
// county listings (Maricopa 100, Pima 103, Pinal 104) and the OpenMHz systems
// list on 2026-10-06. Listener counts and "online" change daily; the pages
// themselves show the current state when they open.
//
// Live only: feeds that run on a delay (Tempe PD's one-hour feeds, DPS D4) are
// left out on purpose.
// Both sites only allow listening on their own pages or apps, so the app opens
// the page itself (in the radio drawer on the truck, a new tab on a computer).
// It never pulls the audio into its own player; that is what their terms forbid.
// Your own receiver (an RTL-SDR box streaming to you) goes in through MY SCANNER.

export const BROADCASTIFY_FEED_URL = 'https://www.broadcastify.com/listen/feed/';
export const OPENMHZ_SYSTEM_URL = 'https://openmhz.com/system/';
export const BROADCASTIFY_COUNTY_URL = 'https://www.broadcastify.com/listen/ctid/';

// Every Arizona county on Broadcastify (ids read from broadcastify.com/listen/stid/4
// on 2026-10-06) with a rough center, used only when the county lookup is offline.
export const COUNTIES = [
  { ctid: 100, name: 'Maricopa', lat: 33.5, lon: -112.3 },
  { ctid: 103, name: 'Pima', lat: 32.1, lon: -111.8 },
  { ctid: 104, name: 'Pinal', lat: 32.9, lon: -111.3 },
  { ctid: 106, name: 'Yavapai', lat: 34.6, lon: -112.5 },
  { ctid: 95, name: 'Coconino', lat: 35.8, lon: -111.8 },
  { ctid: 96, name: 'Gila', lat: 33.8, lon: -110.8 },
  { ctid: 101, name: 'Mohave', lat: 35.7, lon: -113.8 },
  { ctid: 107, name: 'Yuma', lat: 32.8, lon: -113.9 },
  { ctid: 99, name: 'La Paz', lat: 33.7, lon: -113.9 },
  { ctid: 94, name: 'Cochise', lat: 31.9, lon: -109.8 },
  { ctid: 105, name: 'Santa Cruz', lat: 31.5, lon: -110.8 },
  { ctid: 97, name: 'Graham', lat: 32.9, lon: -109.9 },
  { ctid: 98, name: 'Greenlee', lat: 33.2, lon: -109.2 },
  { ctid: 102, name: 'Navajo', lat: 35.4, lon: -110.3 },
  { ctid: 93, name: 'Apache', lat: 35.4, lon: -109.5 },
];

/** area: where the feed is strongest, used to sort by distance from the truck. */
export const FEEDS = [
  // Freeways: DPS Highway Patrol. OpenMHz "azdps" captured DPS Metro East,
  // Metro Central, Metro West, District 1 and District 12 on 2026-10-06.
  {
    id: 'omhz-azdps',
    kind: 'openmhz',
    system: 'azdps',
    name: 'DPS Highway Patrol: Phoenix metro (calls)',
    group: 'Freeways',
    area: { lat: 33.35, lon: -111.75 },
    note: 'Recorded calls, a few seconds behind live. Metro East, Central, West, D1, D12 and Mesa/Gilbert fire.',
  },
  {
    id: 'bcfy-20741',
    kind: 'broadcastify',
    feed: 20741,
    name: 'DPS Highway Patrol: Metro Phoenix West',
    group: 'Freeways',
    area: { lat: 33.45, lon: -112.3 },
  },
  {
    id: 'bcfy-46904',
    kind: 'broadcastify',
    feed: 46904,
    name: 'DPS Highway Patrol: Metro Central',
    group: 'Freeways',
    area: { lat: 33.45, lon: -112.07 },
    note: 'New feed; had no listeners when checked. If it is silent, use the Metro West or OpenMHz feed.',
  },
  {
    id: 'bcfy-47036',
    kind: 'broadcastify',
    feed: 47036,
    name: 'DPS Highway Patrol: District 6 (Pinal, I-10 south)',
    group: 'Freeways',
    area: { lat: 32.9, lon: -111.5 },
  },

  // Phoenix
  {
    id: 'bcfy-12145',
    kind: 'broadcastify',
    feed: 12145,
    name: 'Phoenix Police',
    group: 'Phoenix',
    area: { lat: 33.45, lon: -112.07 },
    note: 'All precinct dispatch (A deck) in the clear. Tactical and priority channels are encrypted, so a chase goes quiet.',
  },
  {
    id: 'bcfy-26983',
    kind: 'broadcastify',
    feed: 26983,
    name: 'Phoenix Police: Cactus Park dispatch',
    group: 'Phoenix',
    area: { lat: 33.6, lon: -112.12 },
  },
  {
    id: 'bcfy-1',
    kind: 'broadcastify',
    feed: 1,
    name: 'Phoenix Fire: metro dispatch and fireground',
    group: 'Phoenix',
    area: { lat: 33.45, lon: -112.07 },
    note: 'Stereo: left is fireground with DPS East, Mesa and Rural Metro; right is Phoenix Fire dispatch.',
  },
  {
    id: 'bcfy-10232',
    kind: 'broadcastify',
    feed: 10232,
    name: 'Maricopa County Sheriff: West (Districts 2 and 3)',
    group: 'West Valley',
    area: { lat: 33.5, lon: -112.45 },
  },
  {
    id: 'bcfy-36987',
    kind: 'broadcastify',
    feed: 36987,
    name: 'Surprise and El Mirage Police dispatch',
    group: 'West Valley',
    area: { lat: 33.63, lon: -112.37 },
  },
  {
    id: 'bcfy-44711',
    kind: 'broadcastify',
    feed: 44711,
    name: 'Sun City West Sheriff Posse',
    group: 'West Valley',
    area: { lat: 33.66, lon: -112.34 },
    note: 'On the air 5 AM to midnight.',
  },

  // East Valley
  {
    id: 'bcfy-14875',
    kind: 'broadcastify',
    feed: 14875,
    name: 'Chandler Police and Fire, Phoenix Fire',
    group: 'East Valley',
    area: { lat: 33.3, lon: -111.84 },
  },
  {
    id: 'bcfy-43570',
    kind: 'broadcastify',
    feed: 43570,
    name: 'Mesa, Gilbert and Queen Creek Fire',
    group: 'East Valley',
    area: { lat: 33.38, lon: -111.75 },
  },
  {
    id: 'omhz-florence',
    kind: 'openmhz',
    system: 'florence',
    name: 'Florence and Pinal area (calls)',
    group: 'East Valley',
    area: { lat: 33.03, lon: -111.39 },
    note: 'Recorded calls. Mostly DPS Metro East and District 6 when checked.',
  },
  {
    id: 'bcfy-46656',
    kind: 'broadcastify',
    feed: 46656,
    name: 'Coolidge, Eloy, Florence, Casa Grande, DPS D6, LifeNet',
    group: 'East Valley',
    area: { lat: 32.88, lon: -111.52 },
  },

  // Tucson
  {
    id: 'omhz-pcwin',
    kind: 'openmhz',
    system: 'pcwin',
    name: 'Pima County PCWIN: Tucson area (calls)',
    group: 'Tucson',
    area: { lat: 32.22, lon: -110.97 },
    note: 'Recorded calls from about 60 agencies. Tucson Police went encrypted in April 2026; fire and sheriff stay clear.',
  },
  {
    id: 'bcfy-38773',
    kind: 'broadcastify',
    feed: 38773,
    name: 'Tucson Police and Fire citywide',
    group: 'Tucson',
    area: { lat: 32.22, lon: -110.97 },
    note: 'Tucson Police is encrypted; fire and public safety stay clear.',
  },
  {
    id: 'bcfy-40088',
    kind: 'broadcastify',
    feed: 40088,
    name: 'Tucson regional dispatch and fire/medical',
    group: 'Tucson',
    area: { lat: 32.22, lon: -110.97 },
  },
  {
    id: 'bcfy-21975',
    kind: 'broadcastify',
    feed: 21975,
    name: 'Tucson regional fire dispatch',
    group: 'Tucson',
    area: { lat: 32.22, lon: -110.97 },
  },
  {
    id: 'bcfy-30258',
    kind: 'broadcastify',
    feed: 30258,
    name: 'Oro Valley Police and Pima County Sheriff',
    group: 'Tucson',
    area: { lat: 32.39, lon: -110.97 },
  },
  {
    id: 'bcfy-45739',
    kind: 'broadcastify',
    feed: 45739,
    name: 'Pima County public safety south, Green Valley',
    group: 'Tucson',
    area: { lat: 31.85, lon: -110.99 },
  },
  {
    id: 'bcfy-47038',
    kind: 'broadcastify',
    feed: 47038,
    name: 'DPS Highway Patrol: District 8 (Tucson)',
    group: 'Tucson',
    area: { lat: 32.2, lon: -110.9 },
  },

  // Weather
  {
    id: 'bcfy-40917',
    kind: 'broadcastify',
    feed: 40917,
    name: 'NOAA Weather Radio Phoenix (dust storm and flood warnings)',
    group: 'Weather',
    area: { lat: 33.45, lon: -112.07 },
  },
  {
    id: 'bcfy-47510',
    kind: 'broadcastify',
    feed: 47510,
    name: 'NOAA Weather Radio Tucson',
    group: 'Weather',
    area: { lat: 32.22, lon: -110.97 },
  },
];

export function feedUrl(feed) {
  if (feed.kind === 'openmhz') return `${OPENMHZ_SYSTEM_URL}${feed.system}`;
  return `${BROADCASTIFY_FEED_URL}${feed.feed}`;
}

export function feedSource(feed) {
  return feed.kind === 'openmhz' ? 'OpenMHz' : 'Broadcastify';
}

/** What a feed row says about where it plays: their page, and for Broadcastify their own sign-in (#66). */
export function feedSourceText(feed) {
  return feed.kind === 'openmhz' ? 'OpenMHz page, no sign-in' : 'Broadcastify page, sign in there';
}
