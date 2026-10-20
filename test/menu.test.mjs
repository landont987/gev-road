import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionText, memoryText } from '../web/src/menu.js';

// Read from the app on the Android 9 emulator (gev-android9), 2026-10-06.
const EMULATOR_UA =
  'Mozilla/5.0 (Linux; Android 9; Android SDK built for arm64 Build/PSR1.210301.009.B6; wv) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.158 Safari/537.36 GEVRoad/0.1.0';

test('versionText shows the app and WebView versions from the head unit user agent', () => {
  assert.equal(versionText(EMULATOR_UA), 'GEV Road 0.1.0 · WebView 66');
});

test('versionText picks up a WebView updated from the Play Store', () => {
  const updated = EMULATOR_UA.replace('Chrome/66.0.3359.158', 'Chrome/138.0.7204.179');
  assert.equal(versionText(updated), 'GEV Road 0.1.0 · WebView 138');
});

test('versionText says the WebView version is unknown when the user agent has none', () => {
  assert.equal(versionText('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0'), 'WebView version unknown');
});

// The MEMORY line (#48): the first head-unit test needs a real number. The
// unit's free memory is the trustworthy figure. On Android 9 the map page runs
// in a WebView process the app cannot see, so with one process listed the line
// says so instead of calling the app process "this app".
const MB = 1048576;
const GB = 1073741824;

test('memoryText leads with the free memory and says the map page is not in a one-process figure', () => {
  const info = JSON.stringify({ app: 96 * MB, processes: 1, free: 640 * MB, total: 1.9 * GB, low: false });
  assert.equal(
    memoryText(info),
    'Memory: the unit has 640 MB free of 1.9 GB. App process 96 MB; the map page runs in a WebView process Android does not report here.',
  );
});

test('memoryText counts the app as a whole when Android lists more than one process', () => {
  const info = JSON.stringify({ app: 212 * MB, processes: 3, free: 640 * MB, total: 1.9 * GB, low: false });
  assert.equal(memoryText(info), 'Memory: the unit has 640 MB free of 1.9 GB. This app 212 MB in 3 processes.');
});

test('memoryText warns when Android says memory is low', () => {
  const info = JSON.stringify({ app: 300 * MB, processes: 2, free: 90 * MB, total: 2 * GB, low: true });
  assert.equal(memoryText(info), 'Memory: the unit has 90 MB free of 2.0 GB. Android says memory is low. This app 300 MB in 2 processes.');
});

test('memoryText keeps the free memory when the app figure is missing', () => {
  const info = JSON.stringify({ app: -1, processes: 0, free: 500 * MB, total: 2 * GB, low: false });
  assert.equal(memoryText(info), 'Memory: the unit has 500 MB free of 2.0 GB.');
  const empty = JSON.stringify({ app: 0, processes: 0, free: 500 * MB, total: 2 * GB, low: false });
  assert.equal(memoryText(empty), 'Memory: the unit has 500 MB free of 2.0 GB.');
});

test('memoryText has a placeholder in the browser and on a unit that reports nothing', () => {
  assert.equal(memoryText(null), 'Memory used: shown on the truck (read from the Android app).');
  assert.equal(memoryText('not json'), 'Memory used: shown on the truck (read from the Android app).');
  assert.equal(memoryText(JSON.stringify({ app: -1 })), 'Memory used: shown on the truck (read from the Android app).');
});
