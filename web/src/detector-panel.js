// The PLATE-READER DETECTOR panel: the USB board's status, and its setup while parked.

import { el, openSheet, setOn, toast } from './ui.js';

/** ctx: { detector, settings, save(), isMoving() } */
export function openDetectorPanel(ctx) {
  const { detector, settings, save } = ctx;
  const body = openSheet('detector', 'Plate-reader detector');
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      "A small USB board (flock-you on a Seeed XIAO ESP32-S3) listens for Flock plate-reader cameras' radios. " +
        'It only listens; it never connects to a camera.',
    ),
  );
  body.appendChild(el('div', { class: 'note' }, detector.statusText()));
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      `${detector.count()} cameras heard so far (orange pins, shown with PLATE READERS). ` +
        `Spoken alerts: ${settings.voice && settings.sayDetector ? 'on' : 'off'} (change it under VOICE).`,
    ),
  );
  const status = detector.status();
  if (!status) return;
  if (ctx.isMoving()) {
    body.appendChild(el('div', { class: 'note warn' }, 'Park to set up the detector.'));
    return;
  }

  if (status.usbHost !== false) addSetup(body, ctx);
  addClear(body, ctx);
}

function addSetup(body, ctx) {
  const { detector, settings, save } = ctx;
  body.appendChild(el('button', { class: 'pill wide', onclick: () => detector.connect() }, 'CONNECT'));

  const weak = el('button', { class: 'pill wide' }, '');
  const paintWeak = () => {
    weak.textContent = settings.detectorWeakHits
      ? 'WEAKER HITS: SPOKEN (more false alarms)'
      : 'WEAKER HITS: PIN ONLY (only strong hits speak)';
    setOn(weak, settings.detectorWeakHits);
  };
  weak.addEventListener('click', () => {
    settings.detectorWeakHits = !settings.detectorWeakHits;
    save();
    paintWeak();
  });
  paintWeak();
  body.appendChild(weak);

  const auto = el('button', { class: 'pill wide' }, '');
  const paintAuto = (on) => {
    auto.textContent = on
      ? 'OPEN GEV ROAD WHEN THE BOARD IS PLUGGED IN: ON'
      : 'OPEN GEV ROAD WHEN THE BOARD IS PLUGGED IN: OFF (tap CONNECT after each start)';
    setOn(auto, on);
  };
  auto.addEventListener('click', () => {
    const on = !detector.autoOpen();
    detector.setAutoOpen(on);
    paintAuto(on);
  });
  paintAuto(detector.autoOpen());
  body.appendChild(auto);
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      'With it on, Android offers "use by default" the next time you tap CONNECT, so it stops asking, ' +
        'and it opens GEV Road whenever the board is plugged in or the unit starts with it.',
    ),
  );
}

function addClear(body, ctx) {
  const { detector } = ctx;
  const clear = el('button', { class: 'pill wide' }, 'CLEAR ALL DETECTOR PINS');
  let armed = false;
  clear.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      clear.textContent = `TAP AGAIN TO CLEAR ${detector.count()} PINS`;
      return;
    }
    detector.clear();
    toast('Detector pins cleared.');
    openDetectorPanel(ctx);
  });
  body.appendChild(clear);
}
