# Changelog

Every build bumps `versionName` and `versionCode` in `android/app/build.gradle.kts`
and `version` in `package.json`, so the ☰ menu's VERSION line tells builds apart.
Each version below has a git tag (`v0.3.9`, ...). APKs are never committed or
uploaded: the API keys are built into them.

## 0.3.14 (2026-10-20)
Fixes from the first head-unit drive (issue #46): no GPS, a slow map, a Broadcastify login, silent channels.
- GPS: the app listens to every location provider the unit has (gps, network, passive), asks the chip for assistance data at start, and centers the map on where the truck was last seen. While there is no fix the status card says why: LOCATION OFF, NO GPS PERMISSION, NO GPS RECEIVER, or GPS 3/11 SATS while searching. The ☰ menu's LOCATION section explains, warns about the antenna after two minutes with no satellite, and offers OPEN LOCATION SETTINGS. A GPS that cannot work is spoken once.
- Map: at most 120 dots per layer (the nearest to the middle of the screen) and none when the whole state is on screen; the start view held 1,073 markers. The ☰ menu's DATA section gains a SCREEN line: pixel ratio, dots drawn, and the frame rate of the last swipe, for the next truck report.
- Radio: the live-calls login can be built into the app (bcfyUser and bcfyPass in keys.local.json), so nothing is typed on the unit. A pack starts with its newest three calls from the last 10 minutes instead of waiting for the next one; the status says "quiet for N min"; a pack over 5 groups polls its two requests side by side. Feed rows say which pages need a sign-in (Broadcastify's web pages do, each time the app restarts; their rules).

## 0.3.13 (2026-10-20)
Second bug and performance sweep before the first head-unit test (page modules and the Android shell; profile in docs/PERF-2026-10-20.md).
- While moving, the map follows the truck again by itself 10 s after a stray finger drag, and a long press no longer opens "Drive here?" (both needed a tap while driving).
- A streamed station or scanner restarts on its own when the stream ends or stalls, not only on an error.
- The 2.4 MB closures feed no longer crosses into the page as one script literal on the UI thread: the page pulls it off-thread. The data meter is read every 5 s instead of on every GPS fix.
- The radio drawer's WebView is built when a station opens and freed on STOP. The USB plate-reader board is retried for 3 s after a screen rebuild instead of once. The voice no longer waits 6 s for OpenAI on a hotspot with no data, and the unit's own voice is restarted if its engine dies.
- Small: a carried GPS speed is carried once; the "No road route" toast shows once per time off route; one HTTP client per timeout.

## 0.3.12 (2026-10-20)
Smoothness pass, part two (profile and findings in docs/PERF-2026-10-20.md).
- Map tiles stay on the unit for 30 days: a familiar route loads from disk, a hotspot drop shows the saved tiles instead of grey squares, and less hotspot data goes to tiles. 150 MB cap, oldest tiles go first. A stalled hotspot pauses tile fetches for 30 s so the page never waits on them.

## 0.3.11 (2026-10-20)
Smoothness pass before the first head-unit test.
- The map keeps DOM markers only for the dots on screen plus half a screen of margin (22 at drive zoom instead of about 1,070), so each GPS recenter moves far fewer elements on the head unit. Spoken alerts and the truck check still use the full lists.
- The ☰ menu's DATA section shows memory: the unit's free memory, a low-memory warning from Android, and the app process. On Android 9 the map page runs in a WebView process the app cannot list, so the line says so.

## 0.3.10 (2026-10-20)
Bug hunt fixes (details in docs/BUG-HUNT-2026-10-20.md).
- Radio drawer: a Broadcastify feed opens on its player. The app banner is dismissed, and their sign-in box shows on screen. Broadcastify now needs a free sign-in to listen; sign in once in the drawer while parked. The sign-in is saved.
- Live calls: one request at a time (no double billing), no stale calls after switching packs, stop on a refused login or empty balance instead of retrying every 6 s, one error toast instead of one every 6 s, a stalled call is skipped.
- AI truck check: Gemini first lists the vehicles without being told about the truck, so a white dump truck is no longer "your truck". A match after you drive off is a toast, not a panel. 45 s per answer.
- Speed and red-light cameras refresh on the truck (overpass-api.de is TLS 1.3 only; now fetched by the app). Requests through the app use the page's timeout instead of always 20 s.
- Road info cards for signs already behind you are dropped from the queue.
- The camera picture stays when you start or stop moving.
- Spoken road names: no more "comma P H X" or "202 dash LOOP".
- The status card no longer slides under the turn bar, and open panels scroll above the radio drawer.

## 0.3.9 (2026-10-20)
- Live radio calls now play. Four fixes: at most 5 talkgroups per Broadcastify request (presets are split), plain commas in the group list (`%2C` made Broadcastify answer 0 calls), the app's own page may start audio without a tap, and closing the web-feed drawer no longer switches live calls off.
- Live calls start from the last 2 minutes instead of an old backlog.

## 0.3.8 (2026-10-20)
- Broadcastify Calls keys built in.

## 0.3.7 (2026-10-20)
- OpenAI voice key built in (13 voices, 30 accents).

## 0.3.6 (2026-10-20)
- A bare Gemini 403 with no reason is temporary (new keys flicker for a few minutes); a 403 with a reason still turns the truck check off.

## 0.3.5 (2026-10-20)
- Gemini key built in: the AI truck check works.

## 0.3.4 (2026-10-20)
- A stand-in keyless camera list is never saved as the AZ511 list.
- The computer preview relays az511.com so road info shows in a browser.

## 0.3.3 (2026-10-20)
- Camera pictures load while moving, not only when stopped.

## 0.3.2 (2026-10-19)
- Road info pop-ups from AZ511: closures, crashes, highway signs, weather stations, rest areas. Cards slide in by themselves; only closures, crashes and high wind speak.
- The AZ511 camera list goes through the Android app (az511.com sends no CORS header) and falls back to the keyless list.

## 0.3.1 (2026-10-19)
- AZ511 key built in: 644 cameras.

## 0.3.0 (2026-10-09)
- USB plate-reader detector (flock-you board) and engine data from AndrOBD.

## 0.2.3 (2026-10-07)
- AI truck check on Gemini's free tier.

## 0.2.2 (2026-10-07)
- Two-view truck photo for the truck check.

## 0.2.1 (2026-10-07)
- Radio drawer matches scanner sites by exact domain.

## 0.2.0 (2026-10-07)
- Spoken alerts, AI voice with accents, AI truck check.

## 0.1.1 (2026-10-06)
- Light map and the VERSION line in the menu.

## 0.1.0 (2026-10-06)
- First build: map, truck GPS, ADOT cameras, plate readers, directions, drive mode, low data, radio.
