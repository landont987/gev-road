import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nearestCounty, countyFromFcc, sortStations } from '../web/src/stations.js';
import { FEEDS } from '../web/src/radio-feeds.js';

test('no delayed feeds are left in the list', () => {
  for (const feed of FEEDS) {
    assert.doesNotMatch(feed.name + (feed.note || ''), /hour behind|delay/i, `${feed.id} is not live`);
  }
  assert.equal(FEEDS.filter((f) => /Tempe/.test(f.name)).length, 0);
});

test('the FCC answer for downtown Phoenix maps to Maricopa, and other states map to nothing', () => {
  const az = { results: [{ county_name: 'Maricopa County', county_fips: '04013', state_code: 'AZ' }] };
  assert.equal(countyFromFcc(az).ctid, 100);
  assert.equal(countyFromFcc({ results: [{ county_name: 'Clark County', state_code: 'NV' }] }), null);
  assert.equal(countyFromFcc({ results: [] }), null);
  assert.equal(countyFromFcc(null), null);
});

test('nearest county by center: Tucson is Pima, Casa Grande is Pinal', () => {
  assert.equal(nearestCounty({ lat: 32.22, lon: -110.97 }).name, 'Pima');
  assert.equal(nearestCounty({ lat: 32.88, lon: -111.75 }).name, 'Pinal');
});

test('stations sort nearest first, drop HLS and bad urls, and keep unplaced ones last', () => {
  const rows = [
    { stationuuid: 'a', name: 'Far', url_resolved: 'https://x/a', geo_lat: 32.22, geo_long: -110.97, tags: 'news,talk,local,extra', codec: 'MP3', bitrate: 128, hls: 0 },
    { stationuuid: 'b', name: 'Near', url_resolved: 'http://x/b', geo_lat: 33.45, geo_long: -112.07, tags: '', codec: 'AAC', bitrate: 64, hls: 0 },
    { stationuuid: 'c', name: 'Nowhere', url_resolved: 'https://x/c', geo_lat: 0, geo_long: 0, codec: 'MP3', bitrate: 0, hls: 0 },
    { stationuuid: 'd', name: 'HLS', url_resolved: 'https://x/d.m3u8', geo_lat: 33.45, geo_long: -112.07, hls: 1 },
    { stationuuid: 'e', name: 'Bad', url_resolved: 'rtsp://x/e', hls: 0 },
  ];
  const sorted = sortStations(rows, { lat: 33.4484, lon: -112.074 });
  assert.deepEqual(sorted.map((s) => s.name), ['Near', 'Far', 'Nowhere']);
  assert.equal(sorted[0].codec, 'AAC 64k');
  assert.equal(sorted[1].tags, 'news, talk, local');
  assert.equal(sorted[2].miles, null);
  assert.ok(sorted[1].miles > 90 && sorted[1].miles < 120);
});
