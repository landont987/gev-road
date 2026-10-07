// Switches the driver sets, remembered between app launches.
// Storage can throw on some WebViews, so every access is guarded.

const KEY = 'gev-road-settings';
const DEFAULTS = { cameras: true, plates: true, traffic: false, lowData: false, drive: false };

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.assign({}, DEFAULTS, saved);
  } catch (err) {
    return Object.assign({}, DEFAULTS);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    // Not saved: the switches still work for this session.
  }
}

/** Cached JSON with an age limit. Returns null when missing, stale or unreadable. */
export function readCache(key, maxAgeMs) {
  try {
    const entry = JSON.parse(localStorage.getItem(key) || 'null');
    if (entry && Date.now() - entry.at < maxAgeMs) return entry.value;
  } catch (err) {
    // Treat unreadable cache as missing.
  }
  return null;
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch (err) {
    // Cache is an optimization; the app refetches next time.
  }
}
