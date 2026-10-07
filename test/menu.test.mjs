import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionText } from '../web/src/menu.js';

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
