import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAz511Api } from '../web/src/parse.js';

const IMAGE_BASE = 'https://az511.com/map/Cctv/';

test('keyed AZ511 rows become camera records with the official picture address', () => {
  const rows = [
    {
      Id: 1208,
      Latitude: 33.4601,
      Longitude: -112.0735,
      Location: 'I-10 at 7th Ave',
      Roadway: 'I-10',
      Direction: 'East',
      Views: [{ Id: 1208, Url: 'https://untrusted.invalid/ignored.jpg', Status: 'Enabled' }],
    },
  ];
  const cams = parseAz511Api(rows, IMAGE_BASE);
  assert.equal(cams.length, 1);
  assert.deepEqual(cams[0], {
    id: '1208',
    lat: 33.4601,
    lon: -112.0735,
    road: 'I-10',
    direction: 'East',
    name: 'I-10 at 7th Ave',
    imageUrl: 'https://az511.com/map/Cctv/1208',
  });
});

test('keyed AZ511 rows without an enabled view, a position or a numeric id are dropped', () => {
  const rows = [
    { Id: 1, Latitude: 33.4, Longitude: -112, Views: [{ Id: 9, Status: 'Disabled' }] },
    { Id: 2, Latitude: 'x', Longitude: -112, Views: [{ Id: 10, Status: 'Enabled' }] },
    { Id: 3, Latitude: 33.4, Longitude: -112, Views: [{ Id: '../x', Status: 'Enabled' }] },
    { Id: 4, Latitude: 33.4, Longitude: -112, Views: [] },
    null,
  ];
  assert.deepEqual(parseAz511Api(rows, IMAGE_BASE), []);
  assert.deepEqual(parseAz511Api({}, IMAGE_BASE), []);
  assert.deepEqual(parseAz511Api(null, IMAGE_BASE), []);
});
