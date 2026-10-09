// The plate-reader detector's lines -> detections, map pins and spoken alerts.
// The detector is a flock-you board (MIT, colonelpanichacks/flock-you) on the
// head unit's USB: it listens for Flock cameras' radios and prints one JSON
// line per hit. Pure: no DOM, no timers, no storage.

// The board's confidence ladder (flock-you main.cpp alertTypeToTier and
// api/flockyou.py METHOD_TIERS), used when a line has no detection_tier.
const METHOD_TIERS = {
  wifi_wildcard_probe_ie_sig: 4,
  wifi_wildcard_probe: 3,
  wifi_oui_addr2: 2,
  ble_name: 2,
  ble_mfg: 2,
  ble_gatt_svc: 2,
  wifi_oui_addr1: 1,
  wifi_oui_addr3: 1,
  wifi_ssid: 0,
};
const TIER_LABELS = {
  4: 'High: the camera radio fingerprint',
  3: 'Good: a camera-style radio scan',
  2: 'Low: a radio maker or battery pack match',
};
export const PIN_MIN_TIER = 2; // tiers 0 and 1 are echoes and name matches that misfire: ignored
export const STRONG_TIER = 3; // spoken by default; tier 2 only with "weaker hits" on
export const MAX_RECORDS = 300;
export const DETECTION_TEXT = 'Plate reader camera detected.';
const MAX_LINE_CHARS = 2048;
const MAC_RE = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const FIX_MAX_AGE_MS = 10000; // an older position does not place a pin
const GONE_MS = 5 * 60 * 1000; // a camera not heard this long has been left behind
const MAC_SPEAK_GAP_MS = 10 * 60 * 1000; // and speaks again on return only after this long
const ANY_SPEAK_GAP_MS = 60 * 1000; // a second camera at the same spot within a minute stays quiet
const FORGET_MS = 60 * 60 * 1000; // speech memory older than this is dropped
const MAX_REMEMBERED = 500; // and at most this many cameras (a broken board could invent thousands)

/** One line from the board -> { mac, tier, rssi } for a detection, else null. */
export function parseDetectorLine(line) {
  if (typeof line !== 'string' || line.length > MAX_LINE_CHARS || line.charAt(0) !== '{') return null;
  let o;
  try {
    o = JSON.parse(line);
  } catch (err) {
    return null;
  }
  if (!o || o.event !== 'detection' || typeof o.detection_method !== 'string') return null;
  const mac = String(o.mac_address || '').toLowerCase();
  if (!MAC_RE.test(mac)) return null;
  const method = o.detection_method.slice(0, 40);
  const known = Object.prototype.hasOwnProperty.call(METHOD_TIERS, method); // not "constructor" or "__proto__"
  const tier =
    Number.isInteger(o.detection_tier) && o.detection_tier >= 0 && o.detection_tier <= 4
      ? o.detection_tier
      : known
        ? METHOD_TIERS[method]
        : 0;
  const rssi = Number.isInteger(o.rssi) && o.rssi < 0 && o.rssi >= -127 ? o.rssi : null;
  return { mac, tier, rssi };
}

export function tierLabel(tier) {
  return TIER_LABELS[tier] || 'Low';
}

/** A stored record still has the shape mergeDetection writes (storage can hold anything). */
export function isRecord(r) {
  return (
    !!r &&
    typeof r.mac === 'string' &&
    MAC_RE.test(r.mac) &&
    Number.isInteger(r.tier) &&
    (r.lat === null || (Number.isFinite(r.lat) && Number.isFinite(r.lon))) &&
    Number.isFinite(r.lastAt) &&
    Number.isInteger(r.count)
  );
}

/**
 * Adds one detection to the records (newest first, at most MAX_RECORDS).
 * The pin sits where the truck was when that camera's radio was loudest, the
 * closest the truck came. fix: { lat, lon, at } or null.
 * Returns { records, record, changed }: changed when the map needs redrawing.
 */
export function mergeDetection(records, det, fix, now) {
  const here = fix && now - fix.at <= FIX_MAX_AGE_MS ? { lat: fix.lat, lon: fix.lon } : null;
  const old = records.find((r) => r.mac === det.mac) || null;
  const louder =
    !!here && (!old || old.lat === null || (det.rssi !== null && (old.rssi === null || det.rssi > old.rssi)));
  const upgraded = !!old && det.tier > old.tier;
  const record = {
    mac: det.mac,
    tier: old ? Math.max(old.tier, det.tier) : det.tier,
    rssi: louder || !old ? det.rssi : old.rssi,
    lat: louder ? here.lat : old ? old.lat : null,
    lon: louder ? here.lon : old ? old.lon : null,
    firstAt: old ? old.firstAt : now,
    lastAt: now,
    count: (old ? old.count : 0) + 1,
  };
  const next = [record].concat(records.filter((r) => r.mac !== det.mac)).slice(0, MAX_RECORDS);
  return { records: next, record, changed: !old || louder || upgraded };
}

/**
 * Whether to speak for this detection. state: { heardAt: {mac: ms}, spokenAt: {mac: ms}, anyAt }
 * (start with emptySpeechState()). A camera speaks once when first heard, and
 * again only after it was left behind for 5 minutes and 10 have passed: parked
 * next to one, it does not repeat. Returns { speak, state }.
 */
export function speakDecision(det, state, now, weakHits) {
  const heardAt = prune(state.heardAt, now);
  const spokenAt = prune(state.spokenAt, now);
  const lastHeard = heardAt[det.mac];
  const lastSpoken = spokenAt[det.mac];
  heardAt[det.mac] = now;
  const strongEnough = det.tier >= (weakHits ? PIN_MIN_TIER : STRONG_TIER);
  const leftAndBack = lastHeard === undefined || now - lastHeard >= GONE_MS;
  const due = lastSpoken === undefined || (leftAndBack && now - lastSpoken >= MAC_SPEAK_GAP_MS);
  if (!strongEnough || !due) return { speak: false, state: { heardAt, spokenAt, anyAt: state.anyAt } };
  spokenAt[det.mac] = now; // within a minute of another camera this one counts as told
  if (now - state.anyAt < ANY_SPEAK_GAP_MS) return { speak: false, state: { heardAt, spokenAt, anyAt: state.anyAt } };
  return { speak: true, state: { heardAt, spokenAt, anyAt: now } };
}

export function emptySpeechState() {
  return { heardAt: {}, spokenAt: {}, anyAt: -Infinity };
}

function prune(times, now) {
  const recent = Object.keys(times)
    .filter((mac) => now - times[mac] < FORGET_MS)
    .sort((a, b) => times[b] - times[a])
    .slice(0, MAX_REMEMBERED);
  const kept = {};
  for (const mac of recent) kept[mac] = times[mac];
  return kept;
}

/** The panel's one-line status from the app's { state, problem, lines, usbHost }. */
export function statusText(s) {
  if (!s) return 'The detector works in the Android app on the head unit.';
  if (s.usbHost === false) return 'This unit reports no USB host support, so it cannot read the detector.';
  if (s.state === 'listening') return `Listening. ${s.lines} lines from the board since the app opened.`;
  if (s.state === 'permission') return s.problem || 'Detector plugged in. Tap CONNECT so GEV Road may read it.';
  if (s.state === 'failed') return s.problem || 'The detector could not be read.';
  return s.problem || 'No detector plugged in.';
}
