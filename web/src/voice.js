// Spoken alerts. The Android app speaks them (Speech.java): the OpenAI voice
// when there is a key (a cached clip even offline; a clip is about the size of
// one map tile, so low data mode keeps it), the unit's own voice otherwise.
// On a computer the browser's voice stands in, for the mockup.

import { KEYS, OPENAI_TTS_URL } from './config.js';
import { speechBody } from './voice-options.js';
import { duck } from './audio-duck.js';
import { toast } from './ui.js';

// Which switch in the VOICE panel lets each kind of alert speak.
const SWITCH = {
  plate: 'sayPlates',
  camera: 'sayCameras',
  speed: 'sayEnforcement',
  redlight: 'sayEnforcement',
  trip: 'sayTrip',
  link: 'sayLink',
  detector: 'sayDetector',
  engine: 'sayEngine',
  road: 'sayRoad',
};
const SAMPLE = 'This is your GEV Road voice. Plate reader ahead.';

const PROBLEMS = {
  'ai-key-refused': 'OpenAI refused the key, so the unit\'s own voice speaks until the app restarts. Check "openai" in keys.local.json.',
  'ai-key-invalid': 'The OpenAI key has a character that cannot be sent, so the unit\'s own voice speaks until the app restarts. Check "openai" in keys.local.json.',
  'ai-out-of-credit': 'Your OpenAI account is out of credit, so the unit\'s own voice speaks until the app restarts.',
  'ai-request-rejected': 'OpenAI rejected the voice request, so the unit\'s own voice speaks until the app restarts.',
  'ai-audio-failed': 'This unit could not play the AI voice, so its own voice speaks until the app restarts.',
  'no-english': 'The unit\'s voice has no US English. Install "Speech Services by Google" from the Play Store.',
  'tts-failed': 'The unit\'s voice could not speak. Install "Speech Services by Google" from the Play Store.',
};

/** settings: the live settings object */
export function createVoice(settings) {
  window.gevOnSpeaking = (on) => duck(!!on);
  const problems = []; // shown in the VOICE panel too, since a toast can be covered
  // The app reports each problem once per run.
  window.gevOnVoiceProblem = (what) => {
    let text = PROBLEMS[what];
    if (what === 'no-engine') {
      text = KEYS.openai
        ? 'No built-in voice on this unit, so new alerts are silent when offline. Install "Speech Services by Google" from the Play Store.'
        : 'No voice on this unit. Install "Speech Services by Google" from the Play Store, or add an OpenAI key.';
    }
    if (!text) return;
    if (problems.indexOf(text) < 0) problems.push(text);
    toast(text, 9000);
  };

  const hasNativeVoice = () => !!(window.GevNative && typeof window.GevNative.speak === 'function');

  function say(text) {
    if (hasNativeVoice()) {
      const ai = !!KEYS.openai;
      window.GevNative.speak(
        text,
        ai ? OPENAI_TTS_URL : '',
        ai ? KEYS.openai : '',
        ai ? speechBody(text, settings.voiceName, settings.voiceAccent) : '',
      );
      return;
    }
    if (typeof window.SpeechSynthesisUtterance === 'function' && window.speechSynthesis) {
      const u = new window.SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  }

  return {
    /** kind: plate | camera | speed | redlight | trip | link | detector | engine | road */
    alert(kind, text) {
      if (settings.voice && settings[SWITCH[kind]]) say(text);
    },
    /** For the truck check, which has its own switch. */
    sayIfOn(text) {
      if (settings.voice) say(text);
    },
    sample: () => say(SAMPLE),
    problems: () => problems.slice(),
  };
}
