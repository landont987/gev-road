// Engine data from the separate AndrOBD app: its plugin text, what the status
// box shows and when "Engine running hot" is spoken. Pure: no DOM, no timers.
// AndrOBD sends DATA as "mnemonic=value" whenever a value changes (coolant at
// most every ~10 s, voltage about every second), and a DATALIST of
// "mnemonic;description;value;units" lines when its live-data list fills. The
// Android side passes its other readings on only as a "beat": still sending.

export const HOT_F = 230; // a Tundra 5.7 runs about 195-220°F; 230 and up is overheating
const REWARN_MS = 5 * 60 * 1000; // said again every 5 minutes while it stays hot
export const COOLANT_KEY = 'engine_coolant_temperature'; // PID 0x05
export const VOLTS_KEY = 'ecu_voltage'; // PID 0x42, the control module (battery) voltage
export const STALE_MS = 30000; // nothing from AndrOBD this long: nothing is shown
// When AndrOBD's units are °F it sends a coolant reading just before the text
// "engine_coolant_temperature=°F" (at connect and after a units switch), so a
// coolant reading waits this long for that text before it counts. Coolant comes
// at most every 10 s, so the wait never overlaps the next one.
export const SETTLE_MS = 5000;
// OBD-II coolant (PID 05) can say -40 to 215 °C, but coolant boils away well
// before 140 °C: anything above is a bad read (a 0xFF byte decodes as 215 °C).
const COOLANT_MIN_C = -40;
const COOLANT_MAX_C = 140;
const VOLTS_MIN = 6; // a plausible battery reading
const VOLTS_MAX = 20;
export const HOT_TEXT = 'Engine running hot.';
const NOTHING = { coolantC: null, volts: null, heardAt: 0 };

export function cToF(c) {
  return (c * 9) / 5 + 32;
}

export function fToC(f) {
  return ((f - 32) * 5) / 9;
}

/** A coolant temperature in °C if a running engine can have it, else null. */
export function coolantC(c) {
  return Number.isFinite(c) && c >= COOLANT_MIN_C && c <= COOLANT_MAX_C ? c : null;
}

/** A battery voltage if it is plausible, else null. */
export function batteryVolts(v) {
  return Number.isFinite(v) && v >= VOLTS_MIN && v <= VOLTS_MAX ? v : null;
}

/** 'F' for "°F", 'C' for "°C", else null. */
function unitsLetter(text) {
  const m = /^°?([CF])$/.exec(text.trim());
  return m ? m[1] : null;
}

/**
 * One DATA text for coolant or voltage -> { key, value }, with value null when
 * AndrOBD does not know it ("n/a"); or { key, units } when AndrOBD names its
 * coolant units ("engine_coolant_temperature=°F"). Anything else -> null.
 */
export function parseData(text) {
  if (typeof text !== 'string') return null;
  const i = text.indexOf('=');
  if (i < 1) return null;
  const key = text.slice(0, i).trim();
  if (key !== COOLANT_KEY && key !== VOLTS_KEY) return null;
  const raw = text.slice(i + 1).trim();
  const units = key === COOLANT_KEY ? unitsLetter(raw) : null;
  if (units) return { key, units };
  return { key, value: /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : null };
}

/** A DATALIST -> { hasCoolant, hasVolts, coolantUnits: 'C' | 'F' | null }. The last coolant line wins. */
export function parseList(text) {
  const out = { hasCoolant: false, hasVolts: false, coolantUnits: null };
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const fields = line.split(';');
    if (fields.length < 4) continue;
    const key = fields[0].trim();
    if (key === COOLANT_KEY) {
      out.hasCoolant = true;
      out.coolantUnits = unitsLetter(fields[fields.length - 1]);
    } else if (key === VOLTS_KEY) {
      out.hasVolts = true;
    }
  }
  return out;
}

/**
 * The reading after AndrOBD sent anything at all. reading: { coolantC, volts, heardAt } or null.
 * After a silence the old values are dropped, never brought back as current.
 */
export function heard(reading, now) {
  const alive = !!reading && now - reading.heardAt <= STALE_MS;
  return Object.assign({}, alive ? reading : NOTHING, { heardAt: now });
}

/**
 * The reading after one parsed DATA item. coolantUnits comes from AndrOBD's list
 * or units text; while it is unknown, coolant is not shown (°F read as °C would
 * sound a false alarm). An implausible value is ignored; "n/a" clears the value.
 */
export function applyData(reading, item, coolantUnits, now) {
  const next = heard(reading, now);
  if (item.key === COOLANT_KEY) {
    if (item.value === null || !coolantUnits) return Object.assign(next, { coolantC: null });
    const c = coolantC(coolantUnits === 'F' ? fToC(item.value) : item.value);
    return c === null ? next : Object.assign(next, { coolantC: c });
  }
  if (item.value === null) return Object.assign(next, { volts: null });
  const v = batteryVolts(item.value);
  return v === null ? next : Object.assign(next, { volts: v });
}

/** The reading after a new DATALIST: what AndrOBD no longer reads (or names units for) is dropped. */
export function applyList(reading, list) {
  if (!reading) return reading;
  return Object.assign({}, reading, {
    coolantC: list.hasCoolant && list.coolantUnits ? reading.coolantC : null,
    volts: list.hasVolts ? reading.volts : null,
  });
}

/** The values to show. AndrOBD sends only changes, so a value stands while AndrOBD is still sending. */
function fresh(reading, now) {
  if (!reading || now - reading.heardAt > STALE_MS) return { c: null, v: null };
  return { c: reading.coolantC, v: reading.volts };
}

/** "ENGINE 198°F · 14.2 V", or '' when there is nothing fresh. */
export function engineText(reading, now) {
  const { c, v } = fresh(reading, now);
  const parts = [];
  if (c !== null) parts.push(`${Math.round(cToF(c))}°F`);
  if (v !== null) parts.push(`${v.toFixed(1)} V`);
  return parts.length ? `ENGINE ${parts.join(' · ')}` : '';
}

export function isHot(reading, now) {
  const { c } = fresh(reading, now);
  return c !== null && cToF(c) >= HOT_F;
}

/** Say "Engine running hot" now? At 230°F, and again every 5 minutes while it stays hot. */
export function shouldWarn(reading, warnedAt, now) {
  return isHot(reading, now) && now - warnedAt >= REWARN_MS;
}

/** The ENGINE DATA panel's status line. list: parseList() of the last DATALIST. */
export function engineStatus(reading, list, now) {
  const text = engineText(reading, now);
  if (text) return `Receiving from AndrOBD: ${text.slice(7)}.`;
  if (reading && now - reading.heardAt <= STALE_MS) {
    return 'AndrOBD is sending, but no coolant or battery reading yet. Open OBD Data in AndrOBD.';
  }
  if (reading) return `No data from AndrOBD for ${Math.round((now - reading.heardAt) / 1000)} seconds.`;
  if (list.hasCoolant || list.hasVolts) {
    return 'AndrOBD has listed its data but has not sent a reading yet. Open OBD Data in AndrOBD.';
  }
  return 'No data from AndrOBD yet.';
}
