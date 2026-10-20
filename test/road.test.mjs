import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  directionDeg,
  isActiveNow,
  parseEvents,
  parseSigns,
  parseWeather,
  parseRestAreas,
  dueCards,
  spokenLine,
} from '../web/src/road-logic.js';

// Arizona is UTC-7 all year: 2026-10-19 (a Monday) 10:00 AM Arizona = 17:00 UTC.
const MON_10AM = Date.UTC(2026, 9, 19, 17, 0);
const SAT_11PM = Date.UTC(2026, 9, 25, 6, 0); // Sat 10/24 11 PM Arizona

const weekend = {
  StartDate: '10/1/2026 12:00:00 AM-07:00:00',
  EndDate: '12/31/2026 12:00:00 AM-07:00:00',
  // Shaped like AZ511's "FRI 9PM TO MON 5AM" freeway closures.
  Times: [{ StartTime: '21:00:00-07:00:00', EndTime: '05:00:00-07:00:00' }],
  DaysOfWeek: ['Friday', 'Saturday', 'Sunday'],
};

test('directions from AZ511 rows', () => {
  assert.equal(directionDeg('Northbound'), 0);
  assert.equal(directionDeg('West'), 270);
  assert.equal(directionDeg('Texas Canyon Rest Area (EB)'), 90);
  assert.equal(directionDeg('Unknown'), null);
  assert.equal(directionDeg('Both Directions'), null);
});

test('a weekend-night closure is on Saturday night and off Monday morning', () => {
  const event = { RecurrenceSchedules: [weekend] };
  assert.equal(isActiveNow(event, SAT_11PM), true);
  assert.equal(isActiveNow(event, MON_10AM), false);
});

test('an all-day closure outside its dates is off', () => {
  const event = {
    RecurrenceSchedules: [
      {
        StartDate: '11/1/2026 12:00:00 AM-07:00:00',
        EndDate: '11/30/2026 12:00:00 AM-07:00:00',
        Times: [{ StartTime: '00:00:00-07:00:00', EndTime: '23:59:59-07:00:00' }],
        DaysOfWeek: ['Monday'],
      },
    ],
  };
  assert.equal(isActiveNow(event, MON_10AM), false);
});

test('without a schedule, start and planned end decide', () => {
  const start = MON_10AM / 1000 - 600;
  assert.equal(isActiveNow({ StartDate: start, PlannedEndDate: null }, MON_10AM), true);
  assert.equal(isActiveNow({ StartDate: start, PlannedEndDate: start + 60 }, MON_10AM), false);
});

test('events keep active full closures and crashes; lane-open road work and sweepers do not speak', () => {
  const now = MON_10AM;
  const rows = [
    { ID: 1, EventType: 'closures', EventSubType: 'Freewayclosed', IsFullClosure: true, RoadwayName: 'SR-51', DirectionOfTravel: 'North', Latitude: 33.5, Longitude: -112, StartDate: now / 1000 - 60, Description: 'Freeway closed' },
    { ID: 2, EventType: 'roadwork', IsFullClosure: false, Latitude: 33.5, Longitude: -112, StartDate: now / 1000 - 60 },
    { ID: 3, EventType: 'accidentsAndIncidents', EventSubType: 'vehicleOnFire', RoadwayName: 'I-10', Latitude: 33.4, Longitude: -112.1, StartDate: now / 1000 - 60 },
    { ID: 4, EventType: 'accidentsAndIncidents', EventSubType: 'TSWEEP', Description: 'Watch for sweepers on I-10', Latitude: 33.4, Longitude: -112.1, StartDate: now / 1000 - 60 },
    { ID: 5, EventType: 'closures', IsFullClosure: true, Latitude: 33.5, Longitude: -112, RecurrenceSchedules: [weekend] },
    { ID: 6, EventType: 'closures', IsFullClosure: true, Latitude: 0, Longitude: 0, StartDate: 1 },
  ];
  const spots = parseEvents(rows, now);
  assert.deepEqual(spots.map((s) => s.id), ['event:1', 'event:3', 'event:4']);
  assert.equal(spots[0].title, 'FREEWAY CLOSED');
  assert.equal(spots[0].directionDeg, 0);
  assert.equal(spots[1].title, 'VEHICLE FIRE');
  assert.equal(spots[2].speak, false);
});

test('a closed on-ramp shows without speaking', () => {
  const [ramp] = parseEvents([{ ID: 7, EventType: 'closures', EventSubType: 'onrampclosed', IsFullClosure: true, Latitude: 32.2, Longitude: -111, StartDate: 1 }], MON_10AM);
  assert.equal(ramp.title, 'ON-RAMP CLOSED');
  assert.equal(ramp.speak, false);
});

test('signs drop blank and sweeper pages', () => {
  const spots = parseSigns([
    { Id: 'a', Latitude: 33.4, Longitude: -112, Messages: ['NO_MESSAGE'] },
    { Id: 'b', Latitude: 33.4, Longitude: -112, Messages: ['CAUTION\r\nWATCH FOR SWEEPERS'] },
    { Id: 'c', Latitude: 33.4, Longitude: -112, DirectionOfTravel: 'Westbound', Messages: ['CAUTION\r\nWATCH FOR SWEEPERS', 'MINUTES TO AIRPORT\r\nVIA I-10         7'] },
  ]);
  assert.equal(spots.length, 1);
  assert.deepEqual(spots[0].pages, ['MINUTES TO AIRPORT\nVIA I-10         7']);
  assert.equal(spots[0].directionDeg, 270);
});

test('weather speaks only for high wind or a slick road', () => {
  const [calm, windy, slick] = parseWeather([
    { Id: 1, Latitude: 35, Longitude: -112, AirTemperature: '53.6', SurfaceTemperature: '54.5', WindSpeed: '2.7', WindDirection: 'NW', MaxWindSpeed: '5.1', LevelOfGrip: 'Good' },
    { Id: 2, Latitude: 35, Longitude: -112, WindSpeed: '30', MaxWindSpeed: '44', LevelOfGrip: 'Good' },
    { Id: 3, Latitude: 35, Longitude: -112, LevelOfGrip: 'Poor' },
  ]);
  assert.equal(calm.speak, false);
  assert.equal(calm.text, '54°F air · road 55°F · wind 3 mph NW · gusts 5 · grip good');
  assert.equal(windy.speak, true);
  assert.equal(windy.spoken, 'High wind ahead, gusts 44 miles per hour.');
  assert.equal(slick.title, 'SLICK ROAD');
});

test('rest areas show truck spots and their direction', () => {
  const [rest] = parseRestAreas([
    { Id: 8, Latitude: 32.06, Longitude: -110.08, Name: 'Texas Canyon Rest Area (EB)', Status: 'Open', Location: 'I-10 / MP 320', Restroom: 'Yes', TotalTruckSpaces: '22', AvailableTruckSpaces: '0' },
  ]);
  assert.equal(rest.text, 'I-10 / MP 320 · Open · restrooms · 0 of 22 truck spots open');
  assert.equal(rest.directionDeg, 90);
});

// Truck heading north at 30 m/s, at a point on I-17.
const fix = { lat: 34.0, lon: -112.14, bearing: 0, speed: 30 };
const north = (km) => 34.0 + km / 111.0;

test('a closure ahead pops up and speaks once; one behind does not', () => {
  const ahead = { id: 'event:1', kind: 'closure', lat: north(3), lon: -112.14, directionDeg: 0, title: 'FREEWAY CLOSED', road: 'I-17', speak: true };
  const behind = Object.assign({}, ahead, { id: 'event:2', lat: north(-3) });
  const first = dueCards([ahead, behind], fix, {});
  assert.equal(first.cards.length, 1);
  assert.equal(first.cards[0].spot.id, 'event:1');
  assert.equal(first.cards[0].distanceText, '2 mi');
  assert.equal(first.cards[0].say, 'Freeway closed ahead on I 17, in 2 miles.');
  assert.equal(dueCards([ahead, behind], fix, first.shown).cards.length, 0);
});

test('the other side of the freeway is skipped', () => {
  const southbound = { id: 'sign:x', kind: 'sign', lat: north(1), lon: -112.14, directionDeg: 180, pages: ['X'] };
  assert.equal(dueCards([southbound], fix, {}).cards.length, 0);
});

test('closures and crashes come before a nearer sign', () => {
  const sign = { id: 'sign:1', kind: 'sign', lat: north(0.5), lon: -112.14, directionDeg: null, pages: ['X'] };
  const crash = { id: 'event:9', kind: 'crash', lat: north(3.5), lon: -112.14, directionDeg: null, title: 'CRASH', road: '', speak: true };
  const { cards } = dueCards([sign, crash], fix, {});
  assert.deepEqual(cards.map((c) => c.spot.id), ['event:9', 'sign:1']);
  assert.equal(cards[1].say, '');
});

test('a card shows again only after the truck is well past its range', () => {
  const sign = { id: 'sign:1', kind: 'sign', lat: north(1), lon: -112.14, directionDeg: null, pages: ['X'] };
  const { shown } = dueCards([sign], fix, {});
  const stillNear = dueCards([sign], Object.assign({}, fix, { lat: north(-2) }), shown);
  assert.equal(stillNear.shown['sign:1'], true);
  const farAway = dueCards([sign], Object.assign({}, fix, { lat: north(-5) }), shown);
  assert.equal(farAway.shown['sign:1'], undefined);
});

test('parked, only a spot right beside the truck counts', () => {
  const parked = { lat: 34.0, lon: -112.14, bearing: null, speed: 0 };
  const rest = { id: 'rest:1', kind: 'rest', lat: north(2), lon: -112.14, directionDeg: null, title: 'R', text: '' };
  assert.equal(dueCards([rest], parked, {}).cards.length, 0);
});

test('silent kinds never speak', () => {
  assert.equal(spokenLine({ kind: 'sign', pages: ['X'] }, 100), '');
  assert.equal(spokenLine({ kind: 'rest', title: 'R' }, 100), '');
});
