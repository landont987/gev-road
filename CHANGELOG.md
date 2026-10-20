# Changelog

Every build bumps `versionName` and `versionCode` in `android/app/build.gradle.kts`
and `version` in `package.json`, so the ☰ menu's VERSION line tells builds apart.
Each version below has a git tag (`v0.3.9`, ...). APKs are never committed or
uploaded: the API keys are built into them.

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
