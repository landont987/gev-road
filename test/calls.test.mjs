import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHmac } from 'node:crypto';

import { signToken, newCalls, groupChunks, liveQuery, recentOnly } from '../web/src/calls.js';
import { CALL_GROUPS, CALL_PACKS } from '../web/src/calls-groups.js';

const KEYS = { bcfyKeyId: 'kid-123', bcfySecret: 'shh-secret', bcfyAppId: 'gev-road' };

function decodePart(part) {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64');
}

test('the app token is an HS256 JWT with kid, iss, iat and exp, signed with the secret', async () => {
  const token = await signToken(KEYS, {}, 1_700_000_000, webcrypto);
  const [h, p, s] = token.split('.');
  assert.deepEqual(JSON.parse(decodePart(h).toString()), { alg: 'HS256', typ: 'JWT', kid: 'kid-123' });
  assert.deepEqual(JSON.parse(decodePart(p).toString()), { iss: 'gev-road', iat: 1_700_000_000, exp: 1_700_003_600 });
  const expected = createHmac('sha256', 'shh-secret').update(`${h}.${p}`).digest();
  assert.deepEqual(decodePart(s), expected);
  assert.doesNotMatch(token, /[+/=]/, 'base64url only');
});

test('the user token carries sub and utk from the login answer', async () => {
  const token = await signToken(KEYS, { sub: 42, utk: 'tok' }, 1_700_000_000, webcrypto);
  const payload = JSON.parse(decodePart(token.split('.')[1]).toString());
  assert.equal(payload.sub, 42);
  assert.equal(payload.utk, 'tok');
  assert.equal(payload.iss, 'gev-road');
});

test('new calls come out oldest first, deduplicated, with only https audio', () => {
  const answer = {
    lastPos: 1_700_000_020,
    calls: [
      { groupId: '2508-2991', ts: 1_700_000_020, descr: 'PPD - 900 A', duration: 4.2, url: 'https://calls.example/b.mp3' },
      { groupId: '2508-2991', ts: 1_700_000_010, descr: 'PPD - 900 A', duration: 2, url: 'https://calls.example/a.mp3' },
      { groupId: '2508-2991', ts: 1_700_000_005, url: 'http://insecure.example/x.mp3' },
      { groupId: '2508-2991', ts: 'nope', url: 'https://calls.example/c.mp3' },
      null,
    ],
  };
  const seen = { '2508-2991-1700000010': true };
  const calls = newCalls(answer, seen);
  assert.deepEqual(
    calls.map((c) => [c.key, c.descr, c.duration, c.url]),
    [['2508-2991-1700000020', 'PPD - 900 A', 4.2, 'https://calls.example/b.mp3']],
  );
  assert.deepEqual(newCalls({}, {}), []);
  assert.deepEqual(newCalls(null, {}), []);
});

test('every pack points at catalogued groups and no encrypted Phoenix PD deck sneaks in', () => {
  for (const pack of CALL_PACKS) {
    assert.ok(pack.groups.length > 0, `${pack.id} is empty`);
    for (const id of pack.groups) {
      assert.match(id, /^\d+-\d+$/);
      assert.ok(CALL_GROUPS[id], `${id} is not in the catalog`);
    }
  }
  for (const [id, name] of Object.entries(CALL_GROUPS)) {
    assert.doesNotMatch(name, /Hot|TAC|Future Use/i, `${id} ${name} is an encrypted deck`);
  }
});

test('a native answer behaves like the bit of fetch the player uses', async () => {
  const { makeResponse } = await import('../web/src/native-fetch.js');
  const ok = makeResponse(200, '{"lastPos":5,"calls":[]}');
  assert.equal(ok.ok, true);
  assert.deepEqual(await ok.json(), { lastPos: 5, calls: [] });
  const bad = makeResponse(401, '{"errors":[{"status":"401","code":"103","title":"Invalid JWT"}]}');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  assert.equal(await makeResponse(0, null).text(), '');
});

test('presets over 5 groups are split, each request keeps its own position', () => {
  const ids = ['2508-1', '2508-2', '2508-3', '2508-4', '2508-5', '2508-6', '2508-7'];
  const chunks = groupChunks(ids);
  assert.deepEqual(chunks.map((c) => c.groups.length), [5, 2]);
  assert.equal(chunks[0].pos, 0);
});

test('the live query uses plain commas (Broadcastify reads %2C as one unknown group)', () => {
  assert.equal(liveQuery({ groups: ['2508-2811', '2508-2993'], pos: 0 }), 'groups=2508-2811,2508-2993&init=1');
  assert.equal(liveQuery({ groups: ['2508-2811'], pos: 1792483499 }), 'groups=2508-2811&pos=1792483499');
});

test('the first answer starts from the last 2 minutes', () => {
  const calls = [{ ts: 1000 }, { ts: 1890 }, { ts: 1990 }];
  assert.deepEqual(recentOnly(calls, 2000).map((c) => c.ts), [1890, 1990]);
  assert.equal(recentOnly(calls, undefined).length, 3, 'no server time: keep them all');
});
