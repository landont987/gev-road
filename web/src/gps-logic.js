// What to say about the GPS when there is no fix (#64). Pure, for tests.
// status is the Android app's JSON (GpsWatch.statusJson): { permission,
// locationOn, providers, enabled, listening, gnss, satellites, used,
// lastProvider, lastFixAgeS }, or null on a computer.

/** Searching this long with no satellite seen: the antenna is the likely fault. */
export const NO_SATELLITES_WARN_S = 120;

const hasGps = (status) => Array.isArray(status.providers) && status.providers.indexOf('gps') >= 0;
const gpsOn = (status) => Array.isArray(status.enabled) && status.enabled.indexOf('gps') >= 0;

/** The short label on the status card when no fresh fix is in. */
export function gpsShortText(status) {
  if (!status) return 'NO GPS';
  if (!status.permission) return 'NO GPS PERMISSION';
  if (!status.locationOn) return 'LOCATION OFF';
  if (!hasGps(status)) return 'NO GPS RECEIVER';
  if (!gpsOn(status)) return 'GPS OFF';
  if (status.satellites > 0) return `GPS ${status.used}/${status.satellites} SATS`;
  return 'GPS SEARCHING';
}

/** One or two sentences for the menu's LOCATION section. searchingS: seconds since the app started looking. */
export function gpsMenuText(status, searchingS) {
  if (!status) return 'GPS: shown on the truck (read from the Android app).';
  if (!status.permission) {
    return 'Location permission was refused. Allow it in Settings, Apps, GEV Road, Permissions, then reopen the app.';
  }
  if (!status.locationOn) return 'Location is turned off on this unit. Turn it on in Settings, Location.';
  if (!hasGps(status)) {
    const others = (status.listening || []).filter((p) => p !== 'passive');
    return `This unit reports no GPS receiver.${others.length ? ` Listening to: ${others.join(', ')}.` : ''}`;
  }
  if (!gpsOn(status)) return 'The GPS provider is switched off on this unit. Turn it on in Settings, Location.';
  const parts = [];
  if (status.lastFixAgeS >= 0) {
    parts.push(`Last fix ${ago(status.lastFixAgeS)} ago from ${status.lastProvider || 'the unit'}.`);
  } else {
    parts.push('No fix yet since the app opened.');
  }
  parts.push(`${status.used} of ${status.satellites} satellites in use.`);
  if (status.satellites === 0 && status.lastFixAgeS < 0 && searchingS >= NO_SATELLITES_WARN_S) {
    parts.push('No satellite seen at all: check the GPS antenna plug on the back of the unit.');
  }
  return parts.join(' ');
}

function ago(seconds) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** The one spoken line about a GPS that cannot work, or '' when nothing needs saying. */
export function gpsSpokenProblem(status) {
  if (!status) return '';
  if (!status.permission) return 'Location permission was refused. The map cannot follow the truck.';
  if (!status.locationOn) return 'Location is turned off on this unit. Open the menu to turn it on.';
  if (!hasGps(status)) return 'This unit reports no GPS receiver.';
  return '';
}
