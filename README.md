# GEV Road

A small 2D road map for an Android 9 head unit (2 GB RAM, MediaTek MT8163,
1280x720). It keeps the road-focused parts of
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (MIT) and
drops the 3D globe, which is too heavy for the unit.

## What it does

- **Follow my truck:** the map stays centered on the truck's GPS, arrow points the way you drive. Drag the map to look around, tap RECENTER to come back.
- **Directions:** search a place or press and hold the map, then follow the turn bar. Re-routes when you leave the line.
- **Arizona cameras:** about 600 ADOT highway cameras. Tap one for a still picture, only while stopped.
- **Plate readers:** license plate reader locations mapped by OpenStreetMap volunteers.
- **Traffic:** live congestion colors (needs a free TomTom key).
- **Low data:** turns off traffic and camera pictures and stops the map zooming past street level, to save the hotspot. A banner suggests it after 100 MB.
- **Drive mode:** four big buttons, big speed, map locked to the truck.
- **Spoken alerts:** "Plate reader ahead", "You're in view of the I 10 at Tunnel camera", "Speed camera ahead, 40 miles per hour", "Red light camera ahead", hotspot data over 100 MB, off route, GPS lost or back, hotspot lost or back. Each has its own switch under ☰ → VOICE, ALERTS AND AI CHECK. Same-name ADOT cameras along a stretch speak once.
- **AI voice:** with an OpenAI key, pick one of 13 voices and 30 accents (Arabic, Chinese, Indian, British and more). Clips are cached, so a repeated alert costs nothing. Without the key, offline, or in low data mode, the unit's own text-to-speech voice speaks (needs "Speech Services by Google" or another engine on the unit).
- **AI truck check:** stopped for 10 seconds within 300 m of an ADOT camera, the app sends that camera's picture to Claude with your truck photo and description, once per stop. If your truck looks to be in it, it says so and shows the picture with the truck boxed. About 1 to 2 cents and half a MB each; off in low data mode. It is an AI guess: trucks look alike.
- **Radio:** police, fire and highway patrol while you drive, three ways:
  - *Live calls, played here:* Phoenix Police precinct dispatch, Phoenix Fire, DPS freeways, Chandler, Avondale and Sky Harbor, played inside the app from the Broadcastify Calls API (needs the prepaid keys below plus your Broadcastify login, typed once into the app).
  - *Live public safety feeds:* 24 Broadcastify and OpenMHz feeds for Phoenix and Tucson, nearest first, live only (delayed feeds are left out). Each opens that site's own page in a drawer over the map (their terms do not allow pulling the audio into another app); press play on their page, fold the drawer with HIDE and the audio keeps going.
  - *Every feed in this county:* one button opens Broadcastify's full list for the county the truck is in (police, fire, ham repeaters, GMRS, rail, weather, with who is online). The county comes from the FCC census lookup, or the nearest county center when offline.
  - *Radio stations near me:* Arizona internet radio stations from the public-domain Radio Browser directory, nearest first, played right in the page.
  - *My scanner:* an MP3 stream from your own receiver (RTL-SDR plus trunk-recorder, SDRTrunk or OP25), played right in the page.

## Data sources (all checked live on 2026-10-06)

| What | Source | Key |
|---|---|---|
| Map | OpenStreetMap standard tiles, shown as they come (no darkening filter, to keep the head unit fast) | none (OSMF tile policy: light use, app identifies itself) |
| Cameras | ADOT list via AZGeo `ADOT_cameras` FeatureServer; pictures from `az511.com/map/Cctv/<id>` | none |
| Plate readers | `tiles.dontgetflocked.com` hourly OSM extract (DeFlock) | none |
| Directions | OSRM at `routing.openstreetmap.de` (FOSSGIS) | none |
| Search | Photon at `photon.komoot.io` | none |
| Traffic | TomTom flow tiles | free key, not yet verified |
| Cameras (fresh list) | AZ511 API `api/v2/get/cameras` | free AZ511 developer key, 10 calls a minute |
| Live calls | Broadcastify Calls Client API `api.bcfy.io` | app key id, secret and app id from bcfy.io/dev (prepaid, from $5) plus a Broadcastify login |
| Public feeds | Broadcastify feed pages and OpenMHz system pages, opened as-is | none |
| County feed list | Broadcastify county pages, opened as-is; county from `geo.fcc.gov/api/census/area` | none |
| Radio stations | Radio Browser `de1.api.radio-browser.info` (PDDL directory); streams straight from each broadcaster | none |
| Speed and red-light cameras | OpenStreetMap via Overpass (`node["highway"="speed_camera"]` in Arizona), bundled in `web/src/data/az-speed-cameras.json` (26 cameras, 2026-10-07) and refreshed daily when Overpass answers | none |
| AI voice | OpenAI `gpt-4o-mini-tts` at `api.openai.com/v1/audio/speech` | OpenAI API key (pay per use) |
| AI truck check | Anthropic Messages API, `claude-opus-5-5`, at `api.anthropic.com/v1/messages` | Anthropic API key (pay per use) |

Not used, and why: CARTO dark tiles now need a key. AZ511's `/list/getdata/`
and `/map/map*/` paths are blocked by its robots.txt, so camera lists come from
the state's AZGeo copy (and later the official AZ511 API with a key).

## Keys

Put keys in `keys.local.json` (never committed):

```json
{
  "tomtom": "your-key",
  "az511": "your-az511-developer-key",
  "bcfyKeyId": "key id from bcfy.io/dev",
  "bcfySecret": "key secret from bcfy.io/dev",
  "bcfyAppId": "app id from bcfy.io/dev",
  "openai": "OpenAI API key (AI voice)",
  "anthropic": "Anthropic API key (AI truck check)",
  "truckDescription": "year, make, model, color and what stands out"
}
```

For the AI truck check, also save a photo of your truck as `truck.local.jpg`
(about 768 px on the long side; never committed). Keys are built into the
APK, so keep the APK to yourself and set a monthly spending limit on the
OpenAI and Anthropic accounts.

Every key is optional. Without `az511` the camera list is the AZGeo copy (last
edited 2026-03-16). Without the three `bcfy` values the LIVE CALLS section only
shows a note. The Calls API endpoints and token format are copied from working
open source clients; the first run with a real key is the proof.

## Build

Needs Node 24, JDK 17 and the Android SDK (platform 36, build-tools 36).

```bash
npm install
npm test
node scripts/build-web.mjs --android
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`.
`npm run dev` serves the same page at http://localhost:4180 with a demo drive.

## Install from a USB stick

1. Copy the APK to a FAT32 USB stick.
2. On the head unit, open the file manager, open the USB drive, tap the APK.
3. If Android blocks it, allow "Install unknown apps" for the file manager when it asks.
4. Open GEV Road and allow location.
5. For speed: in the Play Store, update "Android System WebView" and, if it is
   installed, "Google Chrome" (on Android 9 either one can be what draws the
   app). Reopen GEV Road; ☰ → VERSION shows the WebView number. 66 is from
   2018; 138 is the newest Android 9 can get (Chrome 139 needs Android 10).

## Credits

Map data © OpenStreetMap contributors. Cameras: ADOT / AZ511. Plate reader
locations: OpenStreetMap volunteers via DeFlock. Routing: OSRM / FOSSGIS.
Search: Photon by komoot. Traffic: TomTom. Radio: Broadcastify and OpenMHz
volunteer feeds, Broadcastify Calls. Map library: Leaflet.
Data source choices from God's Eye View by Bilawal Sidhu (MIT).
