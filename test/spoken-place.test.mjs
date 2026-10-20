// What the voice says for AZ511 road names (closures and crashes). Names as
// AZ511 sent them on 2026-10-20: city codes after a comma, "202-LOOP",
// capital abbreviations, N/S/E/W prefixes and "/" between two streets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenPlace } from '../web/src/alert-logic.js';
import { spokenLine as roadLine } from '../web/src/road-logic.js';

test('city codes after a comma are not read out', () => {
  assert.equal(spokenPlace('EVERGREEN ST ,PHX'), 'EVERGREEN Street');
  assert.equal(spokenPlace('83RD AV ,PEO'), '83RD Avenue');
});

test('"202-LOOP" is Loop 202', () => {
  assert.equal(spokenPlace('202-LOOP'), 'Loop 202');
  assert.equal(spokenPlace('101-LOOP Southbound'), 'Loop 101 Southbound');
});

test('abbreviations in capitals expand like the mixed-case ones', () => {
  assert.equal(spokenPlace('W THOMAS RD'), 'West THOMAS Road');
  assert.equal(spokenPlace('S Country Club Rd'), 'South Country Club Road');
});

test('two streets joined by a slash read as "and"', () => {
  assert.equal(spokenPlace('N 35TH AV/W EVA ST ,PHX'), 'North 35TH Avenue and West EVA Street');
});

test('the old forms still read the same', () => {
  assert.equal(spokenPlace('SR-202 @E of McClintock Dr'), 'Loop 202 at east of McClintock Drive');
  assert.equal(spokenPlace('I-10 @Tunnel EB'), 'I 10 at Tunnel eastbound');
  assert.equal(spokenPlace('I-17 @ 215.5'), 'I 17 at milepost 215.5');
});

test('a crash card speaks the cleaned road name', () => {
  const line = roadLine({ kind: 'crash', speak: true, title: 'CRASH', road: 'EVERGREEN ST ,PHX' }, 3300);
  assert.equal(line, 'Crash ahead on EVERGREEN Street, in 2 miles.');
});
