// engine.js against a fake app bridge, a fake clock and a fake status box: what
// the driver sees and hears for the message orders AndrOBD really sends.

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const box = { textContent: '', hidden: true, classes: new Set() };
box.classList = { toggle: (name, on) => (on ? box.classes.add(name) : box.classes.delete(name)) };
globalThis.document = { getElementById: (id) => (id === 'engine' ? box : null) };
let saved = '';
globalThis.window = { GevNative: { engineList: () => saved } };

const { createEngine } = await import('../web/src/engine.js');
const { SETTLE_MS } = await import('../web/src/engine-logic.js');

const LIST_C = 'engine_coolant_temperature;Coolant Temperature;0.0;°C\necu_voltage;ECU voltage;0.0;V';
let said;
let engine;

function start(savedList) {
  saved = savedList;
  said = [];
  engine = createEngine({ voice: { alert: (kind, text) => said.push(`${kind}: ${text}`) } });
}
const data = (text) => window.gevOnEngine('data', text);
const shown = () => (box.hidden ? '' : box.textContent) + (box.classes.has('hot') ? ' (orange)' : '');
/** Time passes with AndrOBD still sending other readings (the app's beats) and the status refresh. */
function drive(ms) {
  for (let t = 0; t < ms; t += 2000) {
    mock.timers.tick(Math.min(2000, ms - t));
    window.gevOnEngine('beat', '');
    engine.paint();
  }
}

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
});

test('°C: a reading shows after the short wait; 232°F speaks once, then every 5 minutes while still hot', () => {
  start(LIST_C);
  data('engine_coolant_temperature=90.0');
  data('ecu_voltage=14.1');
  assert.equal(shown(), 'ENGINE 14.1 V', 'coolant waits a moment for a units text');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 194°F · 14.1 V');
  data('engine_coolant_temperature=111.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 232°F · 14.1 V (orange)');
  assert.deepEqual(said, ['engine: Engine running hot.']);
  drive(4 * 60 * 1000);
  assert.equal(said.length, 1, 'not again within 5 minutes');
  drive(70 * 1000);
  assert.equal(said.length, 2, 'still hot 5 minutes later: said again (a missed one is not lost)');
});

test('switching AndrOBD to °F after minutes of steady coolant: no false alarm', () => {
  start(LIST_C);
  data('engine_coolant_temperature=90.0');
  drive(3 * 60 * 1000);
  assert.equal(shown(), 'ENGINE 194°F');
  // AndrOBD's order: the number in the new units, then the units text.
  data('engine_coolant_temperature=194.0');
  data('engine_coolant_temperature=°F');
  drive(10000);
  assert.equal(shown(), 'ENGINE 194°F');
  assert.deepEqual(said, []);
  data('engine_coolant_temperature=231.8');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 232°F (orange)', '°F readings after the switch');
  assert.equal(said.length, 1);
});

test('connecting with AndrOBD on °F when its list still says °C: no false alarm', () => {
  start(LIST_C);
  data('engine_coolant_temperature=195.8');
  data('engine_coolant_temperature=°F');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 196°F');
  assert.deepEqual(said, []);
});

test('units never named: voltage shows, coolant does not, nothing is said', () => {
  start('');
  data('engine_coolant_temperature=120.0'); // 120°F warming up; as °C it would be 248°F
  data('ecu_voltage=14.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 14.0 V');
  assert.deepEqual(said, []);
  window.gevOnEngine('list', LIST_C.replace('°C', '°F'));
  data('engine_coolant_temperature=196.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 196°F · 14.0 V', 'once AndrOBD lists its data');
});

test('a coolant-only truck keeps its reading while AndrOBD sends, and hides it when AndrOBD stops', () => {
  start('engine_coolant_temperature;Coolant Temperature;0.0;°C');
  data('engine_coolant_temperature=111.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(said.length, 1);
  drive(2 * 60 * 1000);
  assert.equal(shown(), 'ENGINE 232°F (orange)', 'steady and still hot');
  mock.timers.tick(31000);
  engine.paint();
  assert.equal(shown(), '', 'AndrOBD silent for 31 s');
  assert.match(engine.status(), /No data from AndrOBD for 3\d seconds/);
});

test('a new list without coolant drops the coolant reading', () => {
  start(LIST_C);
  data('engine_coolant_temperature=90.0');
  data('ecu_voltage=14.1');
  mock.timers.tick(SETTLE_MS);
  window.gevOnEngine('list', 'ecu_voltage;ECU voltage;14.1;V');
  engine.paint();
  assert.equal(shown(), 'ENGINE 14.1 V');
});

test('a °F warm-up reading after a switch is not read as °C (the 140 °C cap cannot catch these)', () => {
  start(LIST_C);
  data('engine_coolant_temperature=49.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 120°F');
  data('engine_coolant_temperature=122.0'); // 50 °C in °F; as °C it would be a "hot" 252°F
  data('engine_coolant_temperature=°F');
  assert.equal(shown(), 'ENGINE 122°F', 'the units text settles the waiting reading at once');
  drive(10000);
  assert.deepEqual(said, []);
});

test('the next coolant reading settles the one waiting, and an old timer never settles a newer one early', () => {
  start(LIST_C);
  data('engine_coolant_temperature=90.0');
  mock.timers.tick(1000);
  data('engine_coolant_temperature=91.0');
  assert.equal(shown(), 'ENGINE 194°F', 'the first counts as soon as the second arrives');
  mock.timers.tick(SETTLE_MS - 1000); // when the first one's timer would have fired
  assert.equal(shown(), 'ENGINE 194°F', 'the second still waits its own time');
  mock.timers.tick(1000);
  assert.equal(shown(), 'ENGINE 196°F');
});

test('after AndrOBD goes quiet, an old hot reading never comes back as current or speaks again', () => {
  start(LIST_C);
  data('engine_coolant_temperature=111.0');
  mock.timers.tick(SETTLE_MS);
  assert.equal(said.length, 1);
  mock.timers.tick(10 * 60 * 1000); // an app switch, a hotspot drop, the ignition off
  engine.paint();
  assert.equal(shown(), '');
  window.gevOnEngine('beat', '');
  data('ecu_voltage=12.6');
  engine.paint();
  assert.equal(shown(), 'ENGINE 12.6 V', 'no old 232°F');
  assert.equal(said.length, 1);
});

test('"n/a" from AndrOBD clears the coolant reading', () => {
  start(LIST_C);
  data('engine_coolant_temperature=90.0');
  data('ecu_voltage=14.1');
  mock.timers.tick(SETTLE_MS);
  data('engine_coolant_temperature=n/a');
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 14.1 V');
});

test('a list that arrives while a reading waits decides its units', () => {
  start('');
  data('engine_coolant_temperature=196.0');
  window.gevOnEngine('list', LIST_C.replace('°C', '°F'));
  mock.timers.tick(SETTLE_MS);
  assert.equal(shown(), 'ENGINE 196°F');
});
