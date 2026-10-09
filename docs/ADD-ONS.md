# GEV Road add-ons: status, decisions and shopping lists

Written overnight Oct 8–9, 2026. Prices were checked Oct 8 (US, before tax and
shipping). ✅ = checked at the source, ⚠️ = estimate or not proven yet. You buy
everything yourself; nothing was ordered.

The rule all three follow: GEV Road stays 100% your own code. It only *talks* to
the other programs (USB serial, Android intents, HTTP). No GPL code is copied in.

---

## 1. Plate-reader detector (built, in GEV Road 0.3.0)

A Seeed XIAO ESP32-S3 running **flock-you** (MIT, colonelpanichacks) listens for
Flock plate-reader cameras' Wi-Fi and Bluetooth radios and prints one line per hit
over USB. GEV Road reads those lines, drops an orange diamond where the truck was
when the camera was loudest, and says "Plate reader camera detected". It only
listens: it never connects to a camera.

**Proven:** on the Android 9 emulator with WebView 66 (same as your unit), lines
in the board's exact format went through the same Android code path a real board
uses. 3 cameras pinned, the weak echo ignored, spoken once. A flood of 206 lines in
one second was cut to 20. A security review and a code review checked it; every fix
they asked for is in.
**Not proven:** a real board on the real head unit (no board yet).

**Honest odds:** detection may not work right now. Flock changed its cameras
around December 2025 and again in September 2026. On Sept 16 the flock-you author
said Wi-Fi/Bluetooth detection "may be quickly coming to an end", then published new
signatures on Sept 17 with "no guarantees" (flock-you issue #61, where a tester got
zero hits at five known cameras). The board is $7.49, so it's a cheap experiment.

**Free check before buying:** install 0.3.0 on the head unit and open ☰ →
PLATE-READER DETECTOR. If it says "This unit reports no USB host support", Android
on that unit will not let any app read a USB board, so skip the board. (The
emulator says that; real head units usually support it.)

| Item | Price | Where | |
|---|---|---|---|
| Seeed Studio XIAO ESP32S3 (antenna included) | $7.49 | https://www.seeedstudio.com/XIAO-ESP32S3-p-5627.html | ✅ in stock Oct 8 |
| USB-C to USB-A data cable (a phone cable that carries data) | you likely have one | any | ⚠️ |
| USB-A extension (male to female, 3–6 ft) run from behind the head unit to the glovebox or console | about $8 | any | ⚠️ |

Setup once it arrives:
1. Flash it from the Mac with PlatformIO (`pio run -e xiao_esp32s3 -t upload` in a
   flock-you checkout). I can install PlatformIO and walk you through it, with your OK.
2. Plug it into the head unit's USB. Parked: ☰ → PLATE-READER DETECTOR → CONNECT.
3. Watch it work for a few drives. Then, only if you want, turn on "OPEN GEV ROAD
   WHEN THE BOARD IS PLUGGED IN". That stops Android asking each start, and it makes
   GEV Road open by itself when the board powers up (the auto-start you said to show
   you first).

## 2. Engine data (GEV Road side built, in 0.3.0)

**AndrOBD** (free, GPL-3.0) runs as its own app on the head unit and reads an OBD-II
adapter. GEV Road registers as an AndrOBD plugin using only Android intents and its
own code. It shows "ENGINE 198°F · 14.2 V" under the speed, turns it orange at 230°F,
and says "Engine running hot", again every 5 minutes while it stays hot.

**Proven:** on the Android 9 emulator, messages in AndrOBD's exact format (its plugin
discovery, data list, readings) gave the status line and the spoken warning. A
second review found ways a normal engine could be called hot when AndrOBD is set to
°F (AndrOBD sends the °F number a moment before it says "°F"); those are fixed and
proven on the emulator and in tests. If GEV Road does not know AndrOBD's units yet,
it shows no temperature rather than guess. **Proven Oct 9 with the real AndrOBD
2.7.10 (F-Droid) in demo mode:** it found GEV Road by itself, connected to it, sent its
data list and readings, and GEV Road showed "ENGINE 262°F · 9.3 V" in orange and said
"Engine running hot." It kept sending with GEV Road in front. **Not proven:** the
adapter and your truck.

Before buying anything:
1. ~~Test with AndrOBD's demo mode.~~ Done Oct 9 (you said yes): it works.
2. **Hotspot test.** The WiCAN adapter joins your iPhone hotspot, and the head unit
   has to reach it there. Apple doesn't promise that two hotspot devices can talk to
   each other (user reports say it works). We test it with two devices before you buy.
3. **CAN box.** Your head unit's CAN box most likely only does steering-wheel buttons
   and reverse. Look in the unit's car settings for any engine readout, or we can look
   inside its car app later with REA.

| Item | Price | Where | |
|---|---|---|---|
| WiCAN-OBD (MeatPi, the plain one, not Pro) | $42 + $8 US shipping | https://www.crowdsupply.com/meatpi-electronics/wican (pre-order, ships Nov 3) | ✅ |
| Same, if in stock | $42 | Mouser part WICAN-OBD-C3, https://www.mouser.com/c/?m=MeatPi | ⚠️ stock not confirmed |

WiCAN settings: Protocol elm327, port 3333, **sleep mode ON** (it's off by default
and can drain the battery), and turn on Maximize Compatibility on the iPhone hotspot
(the WiCAN only does 2.4 GHz). In AndrOBD: Adapter type NETWORK, the WiCAN's address,
port 3333.

**Never tap "Clear fault codes" in AndrOBD before an emissions test.** It resets the
readiness checks and Arizona can fail the truck until they're ready again.

Limit: readings arrive while GEV Road or AndrOBD is on the screen. With another app
in front, they pause (Android 9 background rules). A small always-on notification
would fix that if you want it.

## 3. Your own scanner (research done; your decision needed)

**My recommendation: the Raspberry Pi at home**, reached from the truck over your
private-vpn (WireGuard), never open to the internet. In the truck it would fight
150°F parked heat (the Pi 5 is rated to 122°F), 12 V wiring and sudden power cuts,
and it would hear the same metro-wide dispatch anyway.

What the research changed:
- **rdio-scanner has no listening API you may use.** Its free HTTP API only uploads
  calls; listing and playing calls goes over its WebSocket, which it now calls
  proprietary. So GEV Road would read trunk-recorder's saved calls (audio + a small
  JSON file each) from a read-only folder on the Pi instead, with a small script of
  yours. Broadcastify stays as the fallback.
- **Dongles: 3 × RTL-SDR Blog V3.** The V4 is discontinued (May 2026) and fakes are
  common. The new V4L needs newer drivers than the Pi's.
- **Clear today:** Phoenix PD precinct dispatch, Phoenix Fire, Peoria PD A1, Glendale
  dispatch, MCSO, DPS metro. Tac channels are mostly encrypted (never decrypted).
- **DPS did not go encrypted in May** (a rumor and a short test; still clear Oct 3).
  But RadioReference showed **zero Broadcastify Calls activity in 24 hours for AZWINS,
  TOPAZ and MCSO** (RWC had 91). If GEV Road's DPS or TOPAZ buttons are silent, a dead
  Broadcastify feed is the likely cause, not encryption.

Home build (about **$290–340** with the kit antenna):

| Item | Price | Where | |
|---|---|---|---|
| Raspberry Pi 5, 4 GB (8 GB adds nothing here) | $110.00 | https://www.pishop.us/product/raspberry-pi-5-4gb/ | ✅ |
| Official 27 W USB-C power supply | $12.95 | https://www.pishop.us/product/raspberry-pi-27w-usb-c-power-supply-black-us/ | ✅ |
| Official Active Cooler | $10.95 | https://www.pishop.us/product/raspberry-pi-active-cooler/ | ✅ |
| Official 32 GB microSD | $19.95 | https://www.pishop.us/product/raspberry-pi-sd-card-32gb/ | ✅ |
| RTL-SDR Blog V3: 1 with the dipole antenna kit, 2 dongle-only | kit $44.95–49.95, dongle $34.95–39.95 | https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/ (use their Amazon US buttons) | ✅ |
| 4-way splitter (5–1000 MHz) + F-to-SMA adapters + short jumpers | about $15–25 | any | ⚠️ |
| 3 short USB extension cables (the dongles block each other's ports) | about $8–10 | any | ⚠️ |
| Better antenna later: a discone in the attic or outside + coax | about $90–145 | e.g. Tram 1410 | ⚠️ |

Buy RTL-SDRs only from rtl-sdr.com's store, their Amazon buttons or their listed
resellers. Blue or green cases, square silver cases and "Pro" dongles are fakes.

---

## Decisions for you

1. Detector: buy the $7.49 board knowing detection may not work right now?
2. Engine: OK to download AndrOBD (F-Droid, 2.3 MB) to the emulator for the demo test?
3. Scanner: Pi at home or in the truck?
