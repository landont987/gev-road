// The VOICE panel: which alerts speak, the AI voice and accent, and the AI truck check.

import { KEYS } from './config.js';
import { VOICES, ACCENTS } from './voice-options.js';
import { el, openSheet, setOn, toast } from './ui.js';

const SWITCHES = [
  ['sayPlates', 'PLATE READERS AHEAD'],
  ['sayCameras', 'IN VIEW OF A TRAFFIC CAMERA'],
  ['sayEnforcement', 'SPEED AND RED-LIGHT CAMERAS'],
  ['sayTrip', 'DATA AND TRIP ALERTS'],
  ['sayLink', 'LOST GPS OR INTERNET'],
];

/** ctx: { settings, save(), voice, truckCheck, lastFix() } */
export function openVoicePanel(ctx) {
  const { settings, save, voice, truckCheck } = ctx;
  const body = openSheet('voice', 'Voice and alerts');

  function toggle(name, label) {
    const button = el('button', { class: 'pill wide' }, '');
    const paint = () => {
      button.textContent = `${label}: ${settings[name] ? 'ON' : 'OFF'}`;
      setOn(button, settings[name]);
    };
    button.addEventListener('click', () => {
      settings[name] = !settings[name];
      save();
      paint();
    });
    paint();
    return button;
  }

  function choices(name, options) {
    const wrap = el('div', { class: 'choices' });
    const buttons = options.map((o) => {
      const b = el('button', { class: 'pill small choice' }, o.label);
      b.addEventListener('click', () => {
        settings[name] = o.id;
        save();
        buttons.forEach((x, i) => setOn(x, options[i].id === settings[name]));
        voice.sample();
      });
      setOn(b, o.id === settings[name]);
      wrap.appendChild(b);
      return b;
    });
    return wrap;
  }

  body.appendChild(toggle('voice', 'VOICE ALERTS'));

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'SAY OUT LOUD')));
  for (const [name, label] of SWITCHES) body.appendChild(toggle(name, label));

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'VOICE')));
  if (KEYS.openai) {
    body.appendChild(
      el(
        'p',
        { class: 'sheet-sub' },
        "OpenAI voice: AI-generated, not a human. Tap a voice or an accent to hear it. The unit's own voice speaks when there is no internet or low data is on.",
      ),
    );
    body.appendChild(choices('voiceName', VOICES.map((v) => ({ id: v, label: v.toUpperCase() }))));
    body.appendChild(el('h3', { class: 'choices-title' }, 'ACCENT'));
    body.appendChild(choices('voiceAccent', ACCENTS.map((a) => ({ id: a.id, label: a.label.toUpperCase() }))));
  } else {
    body.appendChild(
      el('p', { class: 'sheet-sub' }, "The unit's own voice. Add an OpenAI key to pick from 13 AI voices and 30 accents."),
    );
  }
  body.appendChild(el('button', { class: 'pill wide', onclick: () => voice.sample() }, 'PLAY SAMPLE'));

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'AI TRUCK CHECK')));
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      'When you stop near an ADOT camera, Claude looks at its picture for your truck, once per stop. About 1 to 2 cents and half a MB each.',
    ),
  );
  body.appendChild(toggle('truckCheck', 'AI TRUCK CHECK'));
  const status = el('p', { class: 'sheet-sub' }, `Status: ${truckCheck.status()}`);
  body.appendChild(status);
  truckCheck.hasPhoto().then((has) => {
    status.textContent += has ? ' Your truck photo is loaded.' : ' No truck photo: it uses the description only.';
  });
  body.appendChild(el('p', { class: 'sheet-sub' }, `Last check: ${truckCheck.lastText()}`));
  body.appendChild(
    el('button', { class: 'pill wide', onclick: () => toast(truckCheck.checkNow(ctx.lastFix()), 6000) }, 'CHECK THE NEAREST CAMERA NOW'),
  );
  body.appendChild(el('button', { class: 'pill wide', onclick: () => truckCheck.showLast() }, 'SHOW THE LAST CHECK'));
}
