// The ENGINE DATA panel: what AndrOBD is sending, and how to set it up (parked).

import { el, openSheet } from './ui.js';

const STEPS = [
  'Install AndrOBD from F-Droid (free). It is a separate app; GEV Road only receives its readings.',
  'Open GEV Road once after installing or updating it, so AndrOBD can find it.',
  'In AndrOBD: menu (⋮) → Plugin manager. GEV Road should be listed and switched on.',
  'Connect AndrOBD to the OBD adapter: Settings → OBD options → Adapter type. For a WiCAN on your hotspot: NETWORK, the WiCAN address, port 3333.',
  'Open OBD Data in AndrOBD. The readings show under the speed, and at 230°F GEV Road says "Engine running hot".',
];

const UNITS_TEXT = { F: '°F (GEV Road converts)', C: '°C' };

/** ctx: { engine, isMoving() } */
export function openEnginePanel(ctx) {
  const { engine } = ctx;
  const body = openSheet('engine', 'Engine data (AndrOBD)');
  body.appendChild(el('div', { class: 'note' }, engine.status()));
  const list = engine.list();
  if (list.hasCoolant || list.hasVolts) {
    body.appendChild(
      el(
        'p',
        { class: 'sheet-sub' },
        `AndrOBD reads coolant: ${list.hasCoolant ? 'yes' : 'no'}. Battery voltage: ` +
          `${list.hasVolts ? 'yes' : 'no (this truck may not report it)'}.` +
          (list.hasCoolant
            ? ` Coolant units: ${UNITS_TEXT[list.coolantUnits] || 'not named yet, so no temperature shows. Open OBD Data in AndrOBD again'}.`
            : ''),
      ),
    );
  }
  if (ctx.isMoving()) {
    body.appendChild(el('div', { class: 'note warn' }, 'Park to read the setup steps.'));
    return;
  }
  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'SET UP')));
  STEPS.forEach((step, i) => body.appendChild(el('p', { class: 'sheet-sub' }, `${i + 1}. ${step}`)));
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      'Try it without the truck: in AndrOBD set Adapter type to DEMO, then open OBD Data. ' +
        'Its made-up coolant readings jump around and go above 230°F, so you hear the warning.',
    ),
  );
  body.appendChild(
    el(
      'div',
      { class: 'note warn' },
      'Never tap "Clear fault codes" in AndrOBD before an emissions test: it resets the readiness checks, ' +
        'and Arizona can fail the truck until they are ready again.',
    ),
  );
  body.appendChild(
    el(
      'p',
      { class: 'credits' },
      'Readings arrive while GEV Road or AndrOBD is on the screen. AndrOBD by fr3ts0n (GPL-3.0) is its own app; ' +
        'GEV Road contains none of its code.',
    ),
  );
}
