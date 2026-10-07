// The AI truck check's request and answer: is the driver's truck on this
// traffic camera picture? Pure: no DOM, no network.

const MAX_TOKENS = 400;
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

const imageBlock = (img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });

/**
 * Body for POST /v1/messages. camera: { base64, mediaType, width, height };
 * reference: the driver's own truck photo, or null.
 */
export function truckCheckBody({ model, camera, reference, description }) {
  const content = [];
  if (reference) {
    content.push({ type: 'text', text: "Image 1: the driver's own truck." }, imageBlock(reference));
  }
  const camLabel = reference ? 'Image 2' : 'Image 1';
  content.push({ type: 'text', text: `${camLabel}: the traffic camera picture, ${camera.width} x ${camera.height} pixels.` });
  content.push(imageBlock(camera));
  content.push({
    type: 'text',
    text:
      `The driver's truck: ${description || 'a pickup truck (no description given)'}.\n` +
      `Is a vehicle that matches the driver's truck visible in ${camLabel}? Match on body style, make and model, ` +
      'color, and stand-out features. Many trucks look alike, so set found to true only when the match is clear. ' +
      'Do not read or report license plates and do not describe people.\n' +
      'Answer with only this JSON:\n' +
      `{"found": true or false, "confidence": "low" or "medium" or "high", "box": [x1, y1, x2, y2] around the matching vehicle in ${camLabel} pixel coordinates, or null, "note": "one short sentence, such as where in the picture it is"}`,
  });
  return {
    model,
    max_tokens: MAX_TOKENS,
    system:
      "You check one still picture from an Arizona DOT traffic camera for one specific truck: the driver's own. " +
      'You answer with JSON only.',
    messages: [{ role: 'user', content }],
  };
}

const NOT_FOUND = { found: false, confidence: 'low', box: null, note: '' };
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function percentBox(box, size) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const x1 = clamp(Math.min(box[0], box[2]), 0, size.width);
  const x2 = clamp(Math.max(box[0], box[2]), 0, size.width);
  const y1 = clamp(Math.min(box[1], box[3]), 0, size.height);
  const y2 = clamp(Math.max(box[1], box[3]), 0, size.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return {
    left: round2((x1 / size.width) * 100),
    top: round2((y1 / size.height) * 100),
    width: round2(((x2 - x1) / size.width) * 100),
    height: round2(((y2 - y1) / size.height) * 100),
  };
}

/**
 * The Messages API answer -> { found, confidence, box (percent of the picture) | null, note }.
 * Throws when Claude did not give a usable answer, so a non-answer is never
 * shown as "your truck was not seen".
 */
export function parseTruckCheck(apiJson, size) {
  const stop = apiJson && apiJson.stop_reason;
  if (stop === 'refusal') throw new Error('Claude declined to look at this picture.');
  if (stop === 'max_tokens') throw new Error("Claude's answer was cut off.");
  const blocks = (apiJson && Array.isArray(apiJson.content) && apiJson.content) || [];
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
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
  if (!answer || typeof answer.found !== 'boolean') throw new Error("Claude's answer could not be read.");
  if (!answer.found) return NOT_FOUND;
  return {
    found: true,
    confidence: CONFIDENCE[answer.confidence] ? answer.confidence : 'low',
    box: percentBox(answer.box, size),
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

/**
 * Errors that will not fix themselves at the next stop: a refused key, no
 * credit, an unknown model. Any other 400 (say, one corrupt camera frame), 413,
 * 429 and 5xx are about this picture or this moment.
 */
export function isPermanentApiError(status, bodyText) {
  if (status === 401 || status === 403 || status === 404) return true;
  return status === 400 && /credit balance/i.test(bodyText || '');
}

/** A short, plain reason from an Anthropic error answer. */
export function apiErrorText(status, bodyText) {
  let message = '';
  try {
    const json = JSON.parse(bodyText);
    message = (json && json.error && json.error.message) || '';
  } catch (err) {
    message = '';
  }
  if (status === 401) return 'Anthropic refused the key. Check "anthropic" in keys.local.json.';
  if (/credit balance/i.test(message)) return 'Your Anthropic account is out of credit.';
  if (status === 429) return 'Anthropic says too many checks right now. It tries again shortly.';
  return `Anthropic answered HTTP ${status}${message ? `: ${message.slice(0, 120)}` : ''}.`;
}
