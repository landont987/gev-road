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
- **Drive mode:** three big buttons, big speed, map locked to the truck.

## Data sources (all checked live on 2026-10-06)

| What | Source | Key |
|---|---|---|
| Map | OpenStreetMap standard tiles, darkened in the app | none (OSMF tile policy: light use, app identifies itself) |
| Cameras | ADOT list via AZGeo `ADOT_cameras` FeatureServer; pictures from `az511.com/map/Cctv/<id>` | none |
| Plate readers | `tiles.dontgetflocked.com` hourly OSM extract (DeFlock) | none |
| Directions | OSRM at `routing.openstreetmap.de` (FOSSGIS) | none |
| Search | Photon at `photon.komoot.io` | none |
| Traffic | TomTom flow tiles | free key, not yet verified |

Not used, and why: CARTO dark tiles now need a key. AZ511's `/list/getdata/`
and `/map/map*/` paths are blocked by its robots.txt, so camera lists come from
the state's AZGeo copy (and later the official AZ511 API with a key).

## Keys

Put keys in `keys.local.json` (never committed):

```json
{ "tomtom": "your-key" }
```

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
Search: Photon by komoot. Traffic: TomTom. Map library: Leaflet.
Data source choices from God's Eye View by Bilawal Sidhu (MIT).
