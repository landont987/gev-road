import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  cToF,
  fToC,
  coolantC,
  batteryVolts,
  parseData,
  parseList,
  heard,
  applyData,
  applyList,
  engineText,
  engineStatus,
  isHot,
  shouldWarn,
  HOT_TEXT,
  STALE_MS,
  COOLANT_KEY,
  VOLTS_KEY,
} from '../web/src/engine-logic.js';

// AndrOBD's plugin text formats (AndrOBD V2.7.10): DATA is "mnemonic=value" with the
// value as an unformatted number; DATALIST lines are "mnemonic;description;value;units".
const DATALIST = [
  'engine_load_calculated;Calculated engine load;18.4;%',
  'engine_coolant_temperature;Coolant Temperature;88.0;°C',
  'ecu_voltage;ECU voltage;14.237;V',
  'vehicle_speed;Vehicle speed;0.0;km/h',
].join('\n');
const COOLANT = 'engine_coolant_temperature';

test('readings a running engine cannot have are dropped; missing is not zero', () => {
  assert.equal(coolantC(92), 92);
  assert.equal(coolantC(0), 0, 'a real 32°F morning');
  assert.equal(coolantC(-41), null);
  assert.equal(coolantC(141), null, 'coolant boils away before 140 °C: a bad read');
  assert.equal(coolantC(215), null, 'a 0xFF byte');
  assert.equal(coolantC(null), null);
  assert.equal(coolantC(NaN), null);
  assert.equal(batteryVolts(14.2), 14.2);
  assert.equal(batteryVolts(0), null);
  assert.equal(batteryVolts(65.5), null);
  assert.equal(cToF(100), 212);
  assert.equal(fToC(212), 100);
});

test('parseData: coolant and voltage numbers, "n/a" as unknown, and the units text', () => {
  assert.deepEqual(parseData('engine_coolant_temperature=88.0'), { key: COOLANT, value: 88 });
  assert.deepEqual(parseData('ecu_voltage=14.237'), { key: 'ecu_voltage', value: 14.237 });
  assert.deepEqual(parseData('engine_coolant_temperature=-7.0'), { key: COOLANT, value: -7 });
  assert.deepEqual(parseData('engine_coolant_temperature=n/a'), { key: COOLANT, value: null }, 'a decode error');
  assert.deepEqual(parseData('engine_coolant_temperature=°F'), { key: COOLANT, units: 'F' });
  assert.deepEqual(parseData('engine_coolant_temperature=°C'), { key: COOLANT, units: 'C' });
  assert.equal(parseData('vehicle_speed=40.0'), null, 'not one of ours');
  assert.equal(parseData('=88'), null);
  assert.equal(parseData('engine_coolant_temperature'), null);
  assert.equal(parseData(null), null);
});

test('parseList learns which items AndrOBD reads and its coolant units; the last coolant line wins', () => {
  assert.deepEqual(parseList(DATALIST), { hasCoolant: true, hasVolts: true, coolantUnits: 'C' });
  assert.deepEqual(parseList('engine_coolant_temperature;Coolant Temperature;190.4;°F'), {
    hasCoolant: true,
    hasVolts: false,
    coolantUnits: 'F',
  });
  // The app adds this line when AndrOBD's units change after its list (EngineFeed.lastList).
  assert.equal(parseList(`${DATALIST}\nengine_coolant_temperature;;;°F`).coolantUnits, 'F');
  assert.deepEqual(parseList('engine_coolant_temperature;Coolant Temperature;0.0;'), {
    hasCoolant: true,
    hasVolts: false,
    coolantUnits: null,
  });
  assert.deepEqual(parseList(''), { hasCoolant: false, hasVolts: false, coolantUnits: null });
  assert.deepEqual(parseList('garbage\nmore;garbage'), { hasCoolant: false, hasVolts: false, coolantUnits: null });
  assert.deepEqual(parseList(undefined), { hasCoolant: false, hasVolts: false, coolantUnits: null });
});

test('applyData converts °F, ignores impossible values, clears on "n/a", and shows no coolant without units', () => {
  const t = 5000000;
  let r = applyData(null, parseData('engine_coolant_temperature=88.0'), 'C', t);
  assert.deepEqual(r, { coolantC: 88, volts: null, heardAt: t });
  r = applyData(r, parseData('engine_coolant_temperature=212.0'), 'F', t + 1000);
  assert.equal(r.coolantC, 100, '212°F from an imperial AndrOBD is 100 °C');
  r = applyData(r, parseData('engine_coolant_temperature=215.0'), 'C', t + 2000);
  assert.equal(r.coolantC, 100, 'a 0xFF read changes nothing');
  r = applyData(r, parseData('ecu_voltage=99.0'), 'C', t + 3000);
  assert.deepEqual([r.coolantC, r.volts, r.heardAt], [100, null, t + 3000], 'an impossible voltage is not shown');
  r = applyData(r, parseData('ecu_voltage=14.1'), 'C', t + 4000);
  assert.equal(r.volts, 14.1);
  r = applyData(r, parseData('engine_coolant_temperature=n/a'), 'C', t + 5000);
  assert.equal(r.coolantC, null, 'AndrOBD no longer knows it');
  r = applyData(r, parseData('engine_coolant_temperature=120.0'), null, t + 6000);
  assert.equal(r.coolantC, null, 'units not named: 120 may be °F warming up; as °C it would be a "hot" 248°F');
});

test('applyList drops what AndrOBD no longer reads', () => {
  const r = { coolantC: 90, volts: 14.1, heardAt: 1 };
  assert.deepEqual(applyList(r, parseList(DATALIST)), r);
  assert.deepEqual(applyList(r, parseList('ecu_voltage;ECU voltage;14.2;V')), { coolantC: null, volts: 14.1, heardAt: 1 });
  assert.equal(applyList(null, parseList(DATALIST)), null);
});

test('a steady value stands while AndrOBD keeps sending anything, and everything hides when it stops', () => {
  const t = 7000000;
  let reading = applyData(null, parseData('engine_coolant_temperature=92.0'), 'C', t);
  for (let s = 2; s <= 20 * 60; s += 2) reading = heard(reading, t + s * 1000); // other readings, as beats
  const now = t + 20 * 60 * 1000;
  assert.equal(engineText(reading, now), 'ENGINE 198°F', 'coolant unchanged for 20 minutes still shows');
  assert.equal(engineText(reading, now + STALE_MS + 1), '', 'nothing from AndrOBD for 30 s: nothing shown');
  assert.equal(engineText(null, t), '');
  const both = applyData(reading, parseData('ecu_voltage=14.04'), 'C', now);
  assert.equal(engineText(both, now), 'ENGINE 198°F · 14.0 V');
});

test('isHot, shouldWarn and the status line', () => {
  const t = 9000000;
  const hot = applyData(null, parseData('engine_coolant_temperature=111.0'), 'C', t);
  assert.equal(isHot(hot, t + 1000), true);
  assert.equal(isHot(hot, t + STALE_MS + 1), false, 'never hot from stale data');
  assert.equal(isHot(applyData(null, parseData('engine_coolant_temperature=109.0'), 'C', t), t), false, '228°F');
  assert.equal(shouldWarn(hot, -Infinity, t), true, 'the first time');
  assert.equal(shouldWarn(hot, t, t + 60000), false, 'not again a minute later');
  let stillHot = hot;
  for (let s = 2; s <= 5 * 60; s += 2) stillHot = heard(stillHot, t + s * 1000); // AndrOBD still sending
  assert.equal(shouldWarn(stillHot, t, t + 5 * 60000), true, 'again after 5 minutes while still hot');
  assert.equal(engineText(heard(hot, t + STALE_MS + 1), t + STALE_MS + 1), '', 'after a silence, old values stay gone');
  assert.equal(HOT_TEXT, 'Engine running hot.');
  const list = parseList(DATALIST);
  assert.equal(engineStatus(null, parseList(''), t), 'No data from AndrOBD yet.');
  assert.match(engineStatus(null, list, t), /listed its data/);
  assert.equal(engineStatus(hot, list, t + 1000), 'Receiving from AndrOBD: 232°F.');
  assert.match(engineStatus(heard(null, t), list, t + 1000), /no coolant or battery reading yet/);
  assert.equal(engineStatus(hot, list, t + 60000), 'No data from AndrOBD for 60 seconds.');
});

test('EngineFeed.java forwards exactly the texts this page reads, and writes the units line it parses', () => {
  const java = fs.readFileSync(
    new URL('../android/app/src/main/java/com/landon/gevroad/EngineFeed.java', import.meta.url),
    'utf8',
  );
  assert.ok(java.includes(`COOLANT = "${COOLANT_KEY}="`), 'coolant prefix');
  assert.ok(java.includes(`VOLTS = "${VOLTS_KEY}="`), 'voltage prefix');
  assert.ok(java.includes('COOLANT + "°F"') && java.includes('COOLANT + "°C"'), 'units texts');
  assert.ok(java.includes(`"\\n${COOLANT_KEY};;;"`), 'units line');
});
