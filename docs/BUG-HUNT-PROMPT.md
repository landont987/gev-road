# Bug hunt prompt (paste into a new chat)

Use this to start an unattended bug-hunt chat. It ends by putting the Mac to sleep.

```
Title this chat "GEV Road bug hunt".

You are working on GEV Road, my personal Android 9 truck head-unit app, in
~/projects/gev-road (private repo landont987/gev-road). I know the app has a lot
of bugs. Find as many as you can and fix them before I test it on the truck.
Work as long as you need. I am not watching, so do not stop to ask me things:
decide, write the decision down, and keep going.

START
1. Read CLAUDE.md (rules, build, proven facts), CHANGELOG.md, docs/ADD-ONS.md
   and every open GitHub issue:
   env -u GITHUB_TOKEN gh issue list --repo landont987/gev-road --state open --limit 50
   Read #14 (radio drawer shows the Broadcastify site header and an app ad with
   no play button in view) and #1 (head-unit test checklist) first.
2. Run npm test and sh scripts/test-java.sh
   (JAVA_HOME=~/.local/jdk-17/Contents/Home) and write down the baseline.
3. Create docs/BUG-HUNT-<date>.md. Log every finding there as you go:
   what is wrong, how you found it, file:line, fixed or not, and the version
   it was fixed in.

HUNT (cover all of it, spread the time, don't sink it all into one thing)
- Read every web/src/*.js module and every Java file for real bugs:
  - wrong logic and crashes
  - unhandled promise errors
  - timers that never stop and leaks
  - things that break on Chrome WebView 66 (no optional chaining, no ??, no
    newer APIs unless the build transpiles them; check scripts/build-web.mjs)
  - settings that don't apply
  - features that need a tap while driving
  - text that overflows at 1280x720
- Walk every feature in the browser preview (node scripts/dev.mjs, port 4180,
  started with the preview tools):
  - map
  - cameras and pictures
  - road info cards
  - alerts
  - radio (live calls, presets, the drawer)
  - truck check
  - voice panel
  - low data mode
  - the menu and settings
  Read the console for errors.
- Walk them again on the emulator (AVD gev-android9; adb and the emulator need
  the Bash sandbox off). I approve starting it for this run; close it when the
  walk is done. Use the release-build debug recipe in CLAUDE.md to read the
  page's console. Put the debug flag back before the real build.
- Every bug gets a failing test first where the logic is testable (*-logic.js,
  node:test), then the fix.

SHIPPING (you may push and merge whatever you need)
- One branch and one PR per fix or per small group of related fixes:
  type/short-slug off main. Commits are type(scope): summary, with Closes #N
  when it finishes an issue. Open a new issue for each bug you find, labeled
  bug plus an area label.
- Merge your own PR (squash) once npm test and the Java tests pass on it. Main
  must always pass.
- When a batch of fixes is merged, do a build:
  - bump versionCode + versionName in android/app/build.gradle.kts and version
    in package.json
  - add a CHANGELOG.md entry
  - tag v<version> and push the tag
  - build the release APK (command in CLAUDE.md)
  - copy it to ~/Desktop/GEV-Road-<version>.apk and move the old APK to the
    Trash
- No Co-Authored-By or "Generated with Claude Code" lines anywhere on GitHub.

NEVER
- print, paste or commit a key value. keys.local.json stays git-ignored. Talk
  about names and lengths only.
- commit or upload an APK (keys are baked in), not even to a release.
- relay or embed Broadcastify web-feed audio, decrypt radio, scrape AZ511
  paths robots.txt blocks, or vendor GPL code.
- buy anything, make accounts, or make anything auto-start.
- spend paid API money in loops: Broadcastify ($0.60 per 1K records), OpenAI
  voice (use cached clips). Keep live calls to short checks.

FINISH
1. Close the emulator and stop the preview server.
2. Finish docs/BUG-HUNT-<date>.md and merge it. Open one summary issue,
   "Bug hunt <date>: results". It lists:
   - what was fixed
   - what is still broken and why
   - the final version on the Desktop
   - what I should test first on the truck
3. Your last chat message is the short report: answer first, max 5 bullets,
   one bold action for me.
4. Then run this as your very last command, and do nothing after it:
   pmset sleepnow
```
