import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FEEDS, feedUrl, feedSource } from '../web/src/radio-feeds.js';
import { sortFeedsByDistance, cleanStreamUrl } from '../web/src/radio.js';

test('every feed has a unique id, a name, an area and a real page address', () => {
  const ids = new Set();
  for (const feed of FEEDS) {
    assert.ok(!ids.has(feed.id), `duplicate id ${feed.id}`);
    ids.add(feed.id);
    assert.ok(feed.name.length > 5, `${feed.id} has no name`);
    assert.ok(Number.isFinite(feed.area.lat) && Number.isFinite(feed.area.lon), `${feed.id} has no area`);
    assert.ok(feed.area.lat > 31 && feed.area.lat < 37 && feed.area.lon < -109 && feed.area.lon > -115, `${feed.id} is outside Arizona`);
    const url = feedUrl(feed);
    if (feed.kind === 'broadcastify') {
      assert.ok(Number.isInteger(feed.feed) && feed.feed > 0, `${feed.id} needs a numeric Broadcastify feed`);
      assert.equal(url, `https://www.broadcastify.com/listen/feed/${feed.feed}`);
      assert.equal(feedSource(feed), 'Broadcastify');
    } else {
      assert.equal(feed.kind, 'openmhz');
      assert.match(feed.system, /^[a-z0-9]+$/);
      assert.equal(url, `https://openmhz.com/system/${feed.system}`);
      assert.equal(feedSource(feed), 'OpenMHz');
    }
  }
});

test('nearest first: from downtown Phoenix the Phoenix feeds come before Tucson', () => {
  const sorted = sortFeedsByDistance(FEEDS, { lat: 33.4484, lon: -112.074 });
  assert.equal(sorted[0].miles < 1, true, `nearest is ${sorted[0].miles} mi away`);
  const firstTucson = sorted.findIndex((e) => e.feed.group === 'Tucson');
  const lastPhoenix = sorted.map((e) => e.feed.group).lastIndexOf('Phoenix');
  assert.ok(lastPhoenix < firstTucson, 'a Tucson feed sorted before a Phoenix feed');
  assert.ok(sorted[firstTucson].miles > 80, `first Tucson feed only ${sorted[firstTucson].miles} mi away`);
});

test('nearest first: from Tucson the PCWIN calls lead', () => {
  const sorted = sortFeedsByDistance(FEEDS, { lat: 32.22, lon: -110.97 });
  assert.equal(sorted[0].feed.group, 'Tucson');
});

test('MY SCANNER accepts only an http or https address', () => {
  assert.equal(cleanStreamUrl('  http://192.168.43.5:8000/stream.mp3 '), 'http://192.168.43.5:8000/stream.mp3');
  assert.equal(cleanStreamUrl('https://scanner.example.net/live'), 'https://scanner.example.net/live');
  assert.equal(cleanStreamUrl('javascript:alert(1)'), '');
  assert.equal(cleanStreamUrl('192.168.43.5:8000'), '');
  assert.equal(cleanStreamUrl('http://bad url/with space'), '');
  assert.equal(cleanStreamUrl(''), '');
  assert.equal(cleanStreamUrl(null), '');
});

test('callsLogin: built into the app from the keys, unless one was typed on the unit (#66)', async () => {
  const { callsLogin } = await import('../web/src/radio.js');
  const keys = { bcfyUser: ' landon ', bcfyPass: 'pw' };
  assert.deepEqual(callsLogin({ bcfyUser: '', bcfyPass: '' }, keys), { username: 'landon', password: 'pw', builtIn: true });
  assert.deepEqual(callsLogin({ bcfyUser: 'other', bcfyPass: 'x' }, keys), { username: 'other', password: 'x', builtIn: false });
  assert.deepEqual(callsLogin({}, {}), { username: '', password: '', builtIn: false });
  assert.equal(callsLogin({ bcfyUser: '  ' }, { bcfyUser: 'a' }).builtIn, false, 'a key without a password is not a login');
});

test('feedSourceText tells the driver which pages need a sign-in', async () => {
  const { feedSourceText } = await import('../web/src/radio-feeds.js');
  assert.equal(feedSourceText({ kind: 'openmhz' }), 'OpenMHz page, no sign-in');
  assert.equal(feedSourceText({ kind: 'broadcastify' }), 'Broadcastify page, sign in there');
});
