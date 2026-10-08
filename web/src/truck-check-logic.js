// The AI truck check's request and answer: is the driver's truck on this
// traffic camera picture? Pure: no DOM, no network.

const MAX_TOKENS = 2048; // room for its short thinking plus the JSON
const CONFIDENCE = { low: true, medium: true, high: true };
const OFFLINE_CARD = { type: 'png', width: 540, height: 330 }; // AZ511's "no live feed" picture

/** Width and height from the first bytes of a JPEG or PNG, or null. */
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const read32 = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    return { type: 'png', width: read32(16), height: read32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // SOF0-SOF15 hold the size; C4 (huffman), C8 (reserved) and CC (arithmetic) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: 'jpeg', width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

export function isOfflineCard(size) {
  return !!size && size.type === OFFLINE_CARD.type && size.width === OFFLINE_CARD.width && size.height === OFFLINE_CARD.height;
}

export function bytesFromBase64(b64) {
  const text = atob(b64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

const imagePart = (img) => ({ inline_data: { mime_type: img.mediaType, data: img.base64 } });

const SYSTEM =
  "You check one still picture from an Arizona DOT traffic camera for one specific truck: the driver's own. " +
  'You answer with JSON only.';

/**
 * Body for Gemini's generateContent. camera: { base64, mediaType };
 * reference: the driver's own truck photos (one picture), or null.
 */
export function truckCheckBody({ camera, reference, description }) {
  const parts = [];
  if (reference) {
    parts.push({ text: "Image 1: photos of the driver's own truck (front, and back corner)." }, imagePart(reference));
  }
  const camLabel = reference ? 'Image 2' : 'Image 1';
  parts.push({ text: `${camLabel}: the traffic camera picture.` }, imagePart(camera));
  parts.push({
    text:
      `The driver's truck: ${description || 'a pickup truck (no description given)'}.\n` +
      `Is a vehicle that matches the driver's truck visible in ${camLabel}? Match on body style, make and model, ` +
      'color, and stand-out features. Many trucks look alike, so set found to true only when the match is clear. ' +
      'Do not read or report license plates and do not describe people.\n' +
      'Answer with only this JSON:\n' +
      `{"found": true or false, "confidence": "low" or "medium" or "high", "box_2d": [ymin, xmin, ymax, xmax] around the matching vehicle in ${camLabel}, normalized to 0-1000, or null, "note": "one short sentence, such as where in the picture it is"}`,
  });
  return {
    system_instruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_TOKENS },
  };
}

const NOT_FOUND = { found: false, confidence: 'low', box: null, note: '' };
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const BOX_SCALE = 1000; // Gemini's box_2d is [ymin, xmin, ymax, xmax] on a 0-1000 scale

function percentBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const y1 = clamp(Math.min(box[0], box[2]), 0, BOX_SCALE);
  const y2 = clamp(Math.max(box[0], box[2]), 0, BOX_SCALE);
  const x1 = clamp(Math.min(box[1], box[3]), 0, BOX_SCALE);
  const x2 = clamp(Math.max(box[1], box[3]), 0, BOX_SCALE);
  if (x2 <= x1 || y2 <= y1) return null;
  const pct = (n) => round2((n / BOX_SCALE) * 100);
  return { left: pct(x1), top: pct(y1), width: pct(x2 - x1), height: pct(y2 - y1) };
}

const DECLINED = { SAFETY: true, PROHIBITED_CONTENT: true, BLOCKLIST: true, IMAGE_SAFETY: true, SPII: true, RECITATION: true };

/**
 * Gemini's answer -> { found, confidence, box (percent of the picture) | null, note }.
 * Throws when Gemini did not give a usable answer, so a non-answer is never
 * shown as "your truck was not seen".
 */
export function parseTruckCheck(apiJson) {
  if (apiJson && apiJson.promptFeedback && apiJson.promptFeedback.blockReason) {
    throw new Error('Gemini declined to look at this picture.');
  }
  const candidate = apiJson && Array.isArray(apiJson.candidates) ? apiJson.candidates[0] : null;
  const finish = candidate && candidate.finishReason;
  if (DECLINED[finish]) throw new Error('Gemini declined to look at this picture.');
  if (finish === 'MAX_TOKENS') throw new Error("Gemini's answer was cut off.");
  const parts = (candidate && candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts) || [];
  const text = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let answer = null;
  if (start >= 0 && end > start) {
    try {
      answer = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      answer = null;
    }
  }
  if (!answer || typeof answer.found !== 'boolean') throw new Error("Gemini's answer could not be read.");
  if (!answer.found) return NOT_FOUND;
  return {
    found: true,
    confidence: CONFIDENCE[answer.confidence] ? answer.confidence : 'low',
    box: percentBox(answer.box_2d),
    note: typeof answer.note === 'string' ? answer.note.slice(0, 200) : '',
  };
}

export function base64FromBytes(bytes) {
  const CHUNK = 0x8000; // String.fromCharCode takes a limited number of arguments
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

/** The reason Google gives in an error answer ("API_KEY_INVALID"), or ''. */
function errorReason(json) {
  const details = (json && json.error && Array.isArray(json.error.details) && json.error.details) || [];
  const info = details.find((d) => d && typeof d.reason === 'string');
  return info ? info.reason : '';
}

function readError(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    return { json, message: (json && json.error && json.error.message) || '', status: (json && json.error && json.error.status) || '' };
  } catch (err) {
    return { json: null, message: '', status: '' };
  }
}

/**
 * Errors that will not fix themselves at the next stop: a refused key, the API
 * not switched on, an unknown model, Gemini not offered here. Any other 400
 * (say, one corrupt camera frame), 413, 429 (the free limit) and 5xx are about
 * this picture or this moment.
 */
export function isPermanentApiError(status, bodyText) {
  if (status === 401 || status === 403 || status === 404) return true;
  if (status !== 400) return false;
  const e = readError(bodyText);
  return errorReason(e.json) === 'API_KEY_INVALID' || e.status === 'FAILED_PRECONDITION';
}

/** A short, plain reason from a Gemini error answer. */
export function apiErrorText(status, bodyText) {
  const e = readError(bodyText);
  if (errorReason(e.json) === 'API_KEY_INVALID' || status === 401) return 'Google refused the key. Check "gemini" in keys.local.json.';
  if (status === 403) return 'Google refused the key for Gemini. Make the key again in Google AI Studio.';
  if (status === 429) return "Gemini's free limit is used up for now. It tries again later.";
  return `Gemini answered HTTP ${status}${e.message ? `: ${e.message.slice(0, 120)}` : ''}.`;
}

/**
 * When the camera picture was taken, from the moment it arrived and the
 * cache's Age header (seconds). AZ511 serves each picture from a cache for 30
 * seconds, so Age says how old it is without trusting the unit's clock.
 */
export function pictureTakenAt(receivedAt, ageSeconds) {
  const age = Number(ageSeconds);
  return Number.isFinite(age) && age > 0 ? receivedAt - age * 1000 : receivedAt;
}
