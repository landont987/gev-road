// Fetches the live channel list for a county (calls-directory-logic.js does
// the sorting). One small metadata request, signed with the app's key only (no
// login), kept 5 minutes; the last good list is saved on the unit so a hotspot
// drop still shows channels.

import { KEYS, BCFY_GROUPS_URL } from './config.js';
import { signToken } from './calls.js';
import { nativeFetch } from './native-fetch.js';
import { parseGroups } from './calls-directory-logic.js';

const FRESH_MS = 5 * 60 * 1000;
const DAY_S = 86400; // channels with a call in the last day; the list marks the live ones
const STORE_PREFIX = 'gev-road-channels-';
const memory = {}; // ctid -> { at, channels }

function save(ctid, channels) {
  try {
    localStorage.setItem(STORE_PREFIX + ctid, JSON.stringify({ at: Date.now(), channels }));
  } catch (err) {
    // Not saved: the list still works until the app closes.
  }
}

function saved(ctid) {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_PREFIX + ctid) || 'null');
    return data && Array.isArray(data.channels) ? data.channels : null;
  } catch (err) {
    return null;
  }
}

/** Channels for a county: from memory when fresh, else from Broadcastify, else the saved list. */
export function fetchChannels(ctid) {
  const hit = memory[ctid];
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.channels);
  return signToken(KEYS, {}, Math.floor(Date.now() / 1000))
    .then((token) =>
      nativeFetch(`${BCFY_GROUPS_URL}${encodeURIComponent(ctid)}`, 15000, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secs_ago=${DAY_S}`,
      }),
    )
    .then((res) => {
      if (!res.ok) throw new Error(`the channel list answered HTTP ${res.status}`);
      return res.json();
    })
    .then((rows) => {
      const channels = parseGroups(rows);
      memory[ctid] = { at: Date.now(), channels };
      save(ctid, channels);
      return channels;
    })
    .catch((err) => {
      const old = saved(ctid);
      if (old) return old;
      throw err;
    });
}
