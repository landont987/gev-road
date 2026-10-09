// The ☰ menu: where the location comes from, the demo drive, data use, versions, credits.

import { el, openSheet, closeSheet, toast } from './ui.js';

/** "GEV Road 0.1.0 · WebView 66": the WebView number shows whether a Play Store update took. */
export function versionText(ua) {
  const app = /GEVRoad\/([\w.]+)/.exec(ua);
  const webview = /Chrome\/(\d+)/.exec(ua);
  return [app ? `GEV Road ${app[1]}` : '', webview ? `WebView ${webview[1]}` : 'WebView version unknown']
    .filter(Boolean)
    .join(' · ');
}

/** app: { gps, traffic, routing, dataText(), openVoice(), openDetector(), openEngine() } */
export function openMenu(app) {
  const body = openSheet('menu', 'Menu');
  const gps = app.gps;

  body.appendChild(el('button', { class: 'pill wide', onclick: () => app.openVoice() }, 'VOICE, ALERTS AND AI CHECK'));
  body.appendChild(el('button', { class: 'pill wide', onclick: () => app.openDetector() }, 'PLATE-READER DETECTOR'));
  body.appendChild(el('button', { class: 'pill wide', onclick: () => app.openEngine() }, 'ENGINE DATA (ANDROBD)'));

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'LOCATION')));
  body.appendChild(
    el('p', { class: 'sheet-sub' }, gps.source() === 'truck' ? 'Using the truck GPS.' : 'Using the demo drive (fake GPS).'),
  );
  if (gps.hasTruckGps()) {
    body.appendChild(
      el('button', { class: 'pill wide', onclick: () => { gps.useTruck(); closeSheet(); } }, 'USE TRUCK GPS'),
    );
  }
  body.appendChild(
    el(
      'button',
      {
        class: 'pill wide',
        onclick: () => {
          closeSheet();
          gps.demoDrive(app.routing.current()).catch((err) => {
            console.warn('demo drive:', err);
            toast('Demo drive needs internet to fetch its route.');
          });
        },
      },
      app.routing.current() ? 'DEMO: DRIVE MY ROUTE' : 'DEMO: DRIVE I-17 NORTH',
    ),
  );
  body.appendChild(el('button', { class: 'pill wide', onclick: () => { gps.demoPark(); closeSheet(); } }, 'DEMO: STOP THE TRUCK'));
  body.appendChild(
    el('button', { class: 'pill wide', onclick: () => { gps.demoRestart(); gps.demoPark(); closeSheet(); } }, 'DEMO: BACK TO START'),
  );

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'DATA')));
  body.appendChild(el('p', { class: 'sheet-sub' }, app.dataText()));
  body.appendChild(
    el(
      'p',
      { class: 'sheet-sub' },
      app.traffic.hasKey() ? 'Traffic key: set.' : 'Traffic key: not set yet. Live traffic needs your free TomTom key.',
    ),
  );

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'VERSION')));
  body.appendChild(el('p', { class: 'sheet-sub' }, versionText(navigator.userAgent)));

  body.appendChild(el('div', { class: 'section' }, el('h3', {}, 'CREDITS')));
  body.appendChild(
    el(
      'p',
      { class: 'credits' },
      'Map: OpenStreetMap contributors. Cameras: ADOT / AZ511 via AZGeo. ' +
        'Plate readers: OpenStreetMap volunteers via DeFlock. Directions: OSRM (FOSSGIS). ' +
        'Search: Photon (komoot). Traffic: TomTom. Speed and red-light cameras: OpenStreetMap contributors. ' +
        'AI voice: OpenAI (AI-generated, not a human). AI truck check: Gemini by Google. ' +
        'Plate-reader detector: flock-you by colonelpanichacks (MIT), research by @NitekryDPaul and DeFlockJoplin. ' +
        'Engine data: AndrOBD by fr3ts0n (GPL-3.0), a separate app. Built from the data sources of ' +
        "God's Eye View by Bilawal Sidhu (MIT license).",
    ),
  );
}
