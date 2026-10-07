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
- **Radio:** police, fire and highway patrol while you drive, three ways:
  - *Live calls, played here:* Phoenix Police precinct dispatch, Phoenix Fire, DPS freeways, Chandler, Avondale and Sky Harbor, played inside the app from the Broadcastify Calls API (needs the prepaid keys below plus your Broadcastify login, typed once into the app).
  - *Live public safety feeds:* 24 Broadcastify and OpenMHz feeds for Phoenix and Tucson, nearest first, live only (delayed feeds are left out). Each opens that site's own page in a drawer over the map (their terms do not allow pulling the audio into another app); press play on their page, fold the drawer with HIDE and the audio keeps going.
  - *Every feed in this county:* one button opens Broadcastify's full list for the county the truck is in (police, fire, ham repeaters, GMRS, rail, weather, with who is online). The county comes from the FCC census lookup, or the nearest county center when offline.
  - *Radio stations near me:* Arizona internet radio stations from the public-domain Radio Browser directory, nearest first, played right in the page.
  - *My scanner:* an MP3 stream from your own receiver (RTL-SDR plus trunk-recorder, SDRTrunk or OP25), played right in the page.

## Data sources (all checked live on 2026-10-06)

| What | Source | Key |
|---|---|---|
| Map | OpenStreetMap standard tiles, darkened in the app | none (OSMF tile policy: light use, app identifies itself) |
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
  "bcfyAppId": "app id from bcfy.io/dev"
}
```

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

## Credits

Map data © OpenStreetMap contributors. Cameras: ADOT / AZ511. Plate reader
locations: OpenStreetMap volunteers via DeFlock. Routing: OSRM / FOSSGIS.
Search: Photon by komoot. Traffic: TomTom. Radio: Broadcastify and OpenMHz
volunteer feeds, Broadcastify Calls. Map library: Leaflet.
Data source choices from God's Eye View by Bilawal Sidhu (MIT).
