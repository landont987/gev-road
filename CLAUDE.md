# GEV Road: project guide

Read this first in every session. It holds what is true about the project, how
to build and test it, and the rules the owner set. Open work lives in GitHub
Issues, and shipped work lives in `CHANGELOG.md`.

## What it is
A 2D road map app for the owner's truck head unit, built from the road parts of
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (MIT). The app is
Leaflet in an Android WebView shell (`web/` is the page, `android/` is the shell).
It's a personal sideload, private for now, and the owner wants to make it public
later (see the "Go public" issue).

- **Head unit:** Android 9, 2 GB RAM, MediaTek MT8163, 1280x720, Chrome WebView 66. Internet comes from the owner's phone hotspot.
- **Area:** Phoenix metro and statewide Arizona highways.

## Repo map
- `web/src/*.js`: app modules. Pure logic sits in `*-logic.js` files and has node tests.
  - `cameras.js`: ADOT cameras.
  - `road.js` / `road-logic.js`: AZ511 road info pop-ups.
  - `alerts.js` / `alert-logic.js`: spoken alerts.
  - `calls.js` / `radio.js`: Broadcastify live calls and radio.
  - `truck-check*.js`: Gemini truck check.
  - `detector*.js`: USB plate-reader board.
  - `engine*.js`: AndrOBD engine data.
  - `voice*.js`: OpenAI voice and the built-in TTS fallback.
- `android/app/src/main/java/com/landon/gevroad/`: the Android side.
  - `MainActivity` hosts the page.
  - `NativeHttp` handles allow-listed requests (OkHttp + Conscrypt, TLS 1.3 on Android 9).
  - `Speech` plays voice clips.
  - `RadioDrawer` shows outside radio pages.
  - `Detector` reads the USB board.
  - `AndrobdPlugin` / `EngineDataService` talk to AndrOBD.
- `docs/ADD-ONS.md`: plate-reader board, engine data, and the home scanner plan, with shopping lists.
- `CHANGELOG.md`: one entry per version.

## Build, test, install
- Tests: `npm test` (node:test, 207 tests at 0.3.14) and `sh scripts/test-java.sh` (LineFramer, TileCache and FixPicker; needs `JAVA_HOME=~/.local/jdk-17/Contents/Home`).
- Release APK: `node scripts/build-web.mjs --android && cd android && JAVA_HOME=~/.local/jdk-17/Contents/Home ~/.local/gradle-9.8.0/bin/gradle assembleRelease`, then copy to `~/Desktop/GEV-Road-<version>.apk` and move the previous one to the Trash.
- Every build bumps the version in `android/app/build.gradle.kts` (versionCode + versionName) and in `package.json`, gets a `CHANGELOG.md` entry, and gets a git tag `v<version>`.
- Browser preview: `node scripts/dev.mjs` (port 4180). It relays `/az511/` because az511.com sends no CORS header. Voice, GPS, USB and AndrOBD don't exist in a browser.
- Emulator: AVD `gev-android9` (arm64, Android 9).
  - It takes about 2 GB and slows the owner's other work: ask before starting it and close it right after.
  - `adb` and the emulator need the Bash sandbox off.
- Install on the truck: copy the APK to the owner's FAT32 flash drive ("onn Disk"), verify the sha256, eject; on the unit open the file manager, tap the APK, allow unknown apps once, install.

## Keys (never in chat, never in git)
- `keys.local.json` (git-ignored) holds `az511`, `gemini`, `openai`, `tomtom`, `bcfyKeyId`, `bcfySecret`, `bcfyAppId`, `bcfyUser`, `bcfyPass` (the owner's Broadcastify account, for the live calls' own auth call; empty means the unit asks once) and `truckDescription`.
- `scripts/build-web.mjs` bakes them into the bundle, so **APKs must never be committed or uploaded**, not even to a private release.
- The owner copies a key and runs a one-line `pbpaste | python3 ...` command that writes one slot and prints only the length. Test every new key against its real API before building.
- Status at 0.3.9: az511, gemini, openai and Broadcastify are set and proven; tomtom is empty (free tier, 200K traffic tiles a month, no card).
- `truck.local.jpg` (git-ignored) is the truck photo for the truck check.

## Proven facts (each one cost time)
- **WebView 66:** big GPU canvases never show, so map dots are DOM markers (`dots.js`).
- **TLS 1.3:** every free routing server is TLS 1.3 only, and Android 9 can't do it. `NativeHttp` uses Conscrypt plus the ISRG X2 root.
- **overpass-api.de** is TLS 1.3 only too (2026-10-20), answers 406 to browser user agents and can take 30+ s: it goes through `NativeHttp`.
- **Broadcastify feeds need a free sign-in** (2026-10-20): the player's session POST answers 401 "auth" for guests. Their sign-in box uses CSS `inset`, which WebView 66 ignores; `RadioDrawer` pins it.
- **Gemini truck check:** told what truck to look for, Gemini "finds" it in other vehicles. It lists vehicles neutrally first; see `truck-check-logic.js`.
- **Tiles:** CARTO dark tiles answer 200 with an "API KEY REQUIRED" image. Look at tiles; never trust the status code alone.
- **az511.com and CORS:** the API sends no CORS header. Lists go through `nativeFetch` (Android); pictures load in a plain `<img>`. The closures feed is 2.4 MB (280 KB gzipped), so the `NativeHttp` body cap is 4 MB. Rate limit: 10 calls a minute.
- **AZ511 robots.txt** blocks `/list/getdata/` and `/map/map*/`: never scrape them.
- **Broadcastify Calls live endpoint:**
  - At most 5 groups per request (HTTP 500 code 159).
  - Groups take plain commas: `%2C` gives 200 with 0 calls.
  - `init=1` returns about 25 old calls.
  - The page's own WebView must allow audio without a tap (`setMediaPlaybackRequiresUserGesture(false)`, `MainActivity` only).
  - Broadcastify terms: never relay or embed their web-feed audio. Those pages open in `RadioDrawer`.
  - **Broadcastify Terms section 9 (revised 2026-07-22, read 2026-10-20):** no scripts, bots or automated access to feeds, including scripted sign-in, reconnection or polling, outside the Developer Program (bcfy.io, which the live calls use with the app's keys). So the drawer's web-feed sign-in stays a human tap: never auto-fill or auto-submit their login form. The same section bans AI/ML use of their audio (transcription, alerting, LLM processing): never add that. Their login form has no remember-me box; the session lasts as long as their cookie does, which `RadioDrawer.pause` flushes to disk.
- **Gemini:**
  - New Google keys look like `AQ.` + 50 characters.
  - A brand-new key answers a bare 403 about 1 call in 4 for a few minutes.
  - `gemini-2.5-flash-lite` is closed to new users; the app uses `gemini-3.5-flash-lite`.
  - Creating a key in the in-app browser pane failed as "suspicious"; the owner makes keys in their own Chrome.
- **OpenAI TTS:** `gpt-4o-mini-tts`, clips cached by hash, and the app must disclose that the voice is AI.
- **ADOT:** reuses camera names, so camera alerts are keyed by place.
- **Tile cache (0.3.12):** checked on the emulator 2026-10-20. `adb shell svc wifi disable` and `svc data disable` take the emulator offline; after a force-stop and restart the map shows from `cache/tiles` with DATA 0.0 MB. `run-as com.landon.gevroad find cache/tiles -name '*.png'` counts the tiles.
- **First truck drive, 0.3.13 (2026-10-20):** no GPS fix at all (the shell listened to the `gps` provider only and said nothing about why), the map crawled at zoom 13 with about 1,000 markers, the Broadcastify login had to be typed on the unit, quiet calls packs stayed silent. 0.3.14 answers each (issues #64-#67); the GPS root cause is still unknown until the next drive reports the menu's LOCATION line.
- **GitHub closes only the first issue after one `Closes`:** write `Closes #1, closes #2`, one keyword per number.
- **0.3.13 on the emulator (2026-10-20):** the 2.4 MB closures feed arrives through `/native/http/<id>` in 9 ms; the menu reads "unit 1404 MB free of 1.9 GB, app process 80 MB"; PSS was app 90 MB, WebView renderer 105 MB with the drawer closed and 312 MB with a Broadcastify page open, so STOP (which now destroys the drawer's WebView) gives back about 200 MB. After a swipe during the demo drive the map re-followed within 11 s. DevTools: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` and a node script with the global `WebSocket` (node 22) against `http://127.0.0.1:9222/json`.
- **Debug a release build:**
  1. Temporarily set `WebView.setWebContentsDebuggingEnabled(true)` in `MainActivity`.
  2. Run `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
  3. Drive the page with a small node CDP script: pick the `index.html` target, since `RadioDrawer` is a second page. Wrapping `window.gevOnHttp` shows the native answers.
  4. Set the flag back to `BuildConfig.DEBUG` before the real build.

## Rules from the owner
- **While driving nothing needs a tap.** Info slides in by itself. Only important things speak (closures, crashes, high wind, plate readers, enforcement cameras).
- **Legal only:**
  - Listen to unencrypted radio; never decrypt.
  - Follow each API's terms.
  - No scraping that robots.txt blocks.
  - Never vendor GPL code. AndrOBD talks over intents only.
- **The owner buys every part** and makes every account and key.
- **Nothing auto-starts** without showing the owner first.
- **How to answer:** short plain answers, the answer first. Ask for a decision as "my recommendation is X, yes or no?" End with one bold action for the owner, or "Nothing for you to do."

## GitHub workflow
- **Repo:** private `landont987/gev-road`. Push only commits that passed `npm test`.
- **Issues:** one per unit of work, labeled with an area (`area:cameras`, `area:road-info`, `area:radio`, `area:voice`, `area:truck-check`, `area:detector`, `area:engine`, `area:map`, `area:build`) and a type (`bug`, `feature`, `hardware`, `research`, `go-public`).
- **Commits:** `type(scope): summary`, with `Closes #N` when one finishes an issue.
- **Tags:** `v<version>` on the commit that bumps the version.
