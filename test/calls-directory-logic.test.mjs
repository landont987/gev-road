// The live channel list (#radio): only talkgroups that actually have calls,
// newest first, with one-tap packs. 8 of the 24 hard-coded channels were dead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, parseGroups, liveChannels, buildPacks, channelList, ageText, PACK_MAX, LIST_MAX } from '../web/src/calls-directory-logic.js';

const row = (groupId, tagDescr, ts, extra = {}) =>
  Object.assign({ groupId, tagDescr, ts: String(ts), tgDescr: `${groupId} descr`, tgDisplay: `${groupId} disp`, tgCname: 'Phoenix PD', sName: 'RWC' }, extra);

test('kindOf sorts Broadcastify tags into police, fire and other', () => {
  assert.equal(kindOf('Law Dispatch'), 'police');
  assert.equal(kindOf('Law Tac'), 'police');
  assert.equal(kindOf('Fire Dispatch'), 'fire');
  assert.equal(kindOf('Fire-Tac'), 'fire');
  assert.equal(kindOf('EMS Dispatch'), 'fire');
  assert.equal(kindOf('Security'), 'other');
  assert.equal(kindOf(undefined), 'other');
});

test('parseGroups keeps good rows, newest first, and drops junk and duplicates', () => {
  const out = parseGroups([
    row('2508-1', 'Law Dispatch', 100),
    row('2508-2', 'Fire Dispatch', 300),
    { groupId: 'nope', ts: '5' },
    row('2508-3', 'Security', 'x'),
    row('2508-1', 'Law Dispatch', 999),
    null,
  ]);
  assert.deepEqual(out.map((c) => c.groupId), ['2508-2', '2508-1']);
  assert.equal(out[0].kind, 'fire');
  assert.equal(out[0].name, '2508-2 descr');
  assert.equal(out[0].short, '2508-2 disp');
  assert.equal(out[0].agency, 'Phoenix PD');
  assert.deepEqual(parseGroups({ not: 'a list' }), []);
});

test('parseGroups falls back to the display name, then the id', () => {
  const [a] = parseGroups([row('2508-9', 'Law Dispatch', 5, { tgDescr: '  ', tgDisplay: 'A09' })]);
  assert.equal(a.name, 'A09');
  const [b] = parseGroups([row('2508-8', 'Law Dispatch', 5, { tgDescr: '', tgDisplay: '' })]);
  assert.equal(b.name, '2508-8');
});

test('liveChannels keeps the ones with a call in the last hour', () => {
  const chans = parseGroups([row('1-1', 'Law Dispatch', 10000), row('1-2', 'Law Dispatch', 5000)]);
  assert.deepEqual(liveChannels(chans, 10100).map((c) => c.groupId), ['1-1']);
});

test('buildPacks: police, fire and most active, newest first, capped, empty ones dropped', () => {
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push(row(`2508-${100 + i}`, 'Law Dispatch', 1000 + i));
  rows.push(row('2508-900', 'Security', 5000));
  const packs = buildPacks(parseGroups(rows));
  assert.deepEqual(packs.map((p) => p.id), ['police', 'busy'], 'no fire channels, so no fire pack');
  assert.equal(packs[0].groups.length, PACK_MAX);
  assert.equal(packs[0].groups[0], '2508-113', 'the newest call leads');
  assert.ok(packs[1].groups.indexOf('2508-900') < 0, 'mall security is not in Most active');
});

test('channelList puts live channels first, then quieter ones, capped', () => {
  const rows = [row('1-1', 'Law Dispatch', 100), row('1-2', 'Fire Dispatch', 9990)];
  for (let i = 0; i < 30; i++) rows.push(row(`3-${i}`, 'Security', 50));
  const list = channelList(parseGroups(rows), 10000);
  assert.equal(list[0].groupId, '1-2');
  assert.equal(list.length, LIST_MAX);
});

test('ageText reads like a person would say it', () => {
  assert.equal(ageText(1000, 1030), 'just now');
  assert.equal(ageText(1000, 1000 + 240), '4 min ago');
  assert.equal(ageText(1000, 1000 + 7200), '2 h ago');
  assert.equal(ageText(2000, 1000), 'just now', 'a clock behind the server is not negative');
});
