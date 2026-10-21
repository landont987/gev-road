// The GPS state shown when there is no fix (#64): on the first truck drive the
// card said NO GPS the whole way and gave nothing to go on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpsShortText, gpsMenuText, gpsSpokenProblem, NO_SATELLITES_WARN_S } from '../web/src/gps-logic.js';

const base = {
  permission: true,
  locationOn: true,
  providers: ['gps', 'network', 'passive'],
  enabled: ['gps', 'passive'],
  listening: ['gps', 'network', 'passive'],
  gnss: true,
  satellites: 0,
  used: 0,
  lastProvider: '',
  lastFixAgeS: -1,
};
const status = (extra) => Object.assign({}, base, extra);

test('short text: no status at all (a computer) is NO GPS', () => {
  assert.equal(gpsShortText(null), 'NO GPS');
});

test('short text: the reasons a GPS cannot work come first', () => {
  assert.equal(gpsShortText(status({ permission: false })), 'NO GPS PERMISSION');
  assert.equal(gpsShortText(status({ locationOn: false })), 'LOCATION OFF');
  assert.equal(gpsShortText(status({ providers: ['network', 'passive'] })), 'NO GPS RECEIVER');
  assert.equal(gpsShortText(status({ enabled: ['passive'] })), 'GPS OFF');
});

test('short text: satellites seen and used while searching', () => {
  assert.equal(gpsShortText(status()), 'GPS SEARCHING');
  assert.equal(gpsShortText(status({ satellites: 11, used: 3 })), 'GPS 3/11 SATS');
});

test('menu text: explains the setting, the permission, and a missing receiver', () => {
  assert.match(gpsMenuText(status({ permission: false }), 10), /permission was refused/);
  assert.match(gpsMenuText(status({ locationOn: false }), 10), /Location is turned off/);
  assert.equal(
    gpsMenuText(status({ providers: ['network', 'passive'], listening: ['network', 'passive'] }), 10),
    'This unit reports no GPS receiver. Listening to: network.',
  );
  assert.match(gpsMenuText(status({ enabled: ['passive'] }), 10), /GPS provider is switched off/);
  assert.equal(gpsMenuText(null, 10), 'GPS: shown on the truck (read from the Android app).');
});

test('menu text: searching, then the antenna hint after two minutes with no satellite', () => {
  assert.equal(gpsMenuText(status(), 30), 'No fix yet since the app opened. 0 of 0 satellites in use.');
  assert.match(gpsMenuText(status(), NO_SATELLITES_WARN_S), /GPS antenna plug/);
  assert.doesNotMatch(gpsMenuText(status({ satellites: 4 }), NO_SATELLITES_WARN_S), /antenna/);
});

test('menu text: the last fix with its age and provider', () => {
  assert.equal(
    gpsMenuText(status({ satellites: 12, used: 8, lastProvider: 'gps', lastFixAgeS: 2 }), 300),
    'Last fix 2 s ago from gps. 8 of 12 satellites in use.',
  );
  assert.match(gpsMenuText(status({ lastProvider: 'network', lastFixAgeS: 150 }), 300), /Last fix 3 min ago from network/);
  assert.match(gpsMenuText(status({ lastProvider: 'gps', lastFixAgeS: 7200 }), 9000), /Last fix 2 h ago/);
});

test('spoken problem: only for a GPS that cannot work, never while searching', () => {
  assert.equal(gpsSpokenProblem(null), '');
  assert.equal(gpsSpokenProblem(status()), '');
  assert.equal(gpsSpokenProblem(status({ satellites: 9 })), '');
  assert.match(gpsSpokenProblem(status({ locationOn: false })), /turned off/);
  assert.match(gpsSpokenProblem(status({ permission: false })), /refused/);
  assert.match(gpsSpokenProblem(status({ providers: ['passive'] })), /no GPS receiver/);
});

test('gpsHelp: plain words for every reason there is no position', async () => {
  const { gpsHelp } = await import('../web/src/gps-logic.js');
  assert.equal(gpsHelp(null, 999), null, 'a computer has nothing to say');
  assert.match(gpsHelp(status({ permission: false }), 5).title, /permission/);
  const off = gpsHelp(status({ locationOn: false }), 5);
  assert.match(off.title, /turned off/);
  assert.equal(off.settings, true);
  assert.match(gpsHelp(status({ providers: ['network', 'passive'] }), 5).title, /no GPS receiver/);
  assert.equal(gpsHelp(status({ enabled: ['passive'] }), 5).settings, true);
  assert.match(gpsHelp(status(), 30).title, /Looking/, 'early on it just says it is looking');
  assert.match(gpsHelp(status(), NO_SATELLITES_WARN_S).body, /antenna/, 'two minutes with no satellite: check the antenna');
  assert.equal(gpsHelp(status({ satellites: 7, used: 2 }), 300).title, 'Finding your position: 2 of 4 satellites');
  assert.equal(gpsHelp(status({ satellites: 9, used: 3 }), 300).key, 'finding', 'the key stays put as the count changes');
});
