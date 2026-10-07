// Spoken alerts. The Android app speaks them (Speech.java): the OpenAI voice
// when there is a key, internet and low data is off; the unit's own voice
// otherwise. On a computer the browser's voice stands in, for the mockup.

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
};
const SAMPLE = 'This is your GEV Road voice. Plate reader ahead.';

/** settings: the live settings object; app: { isLowData() } */
export function createVoice(settings, app) {
  window.gevOnSpeaking = (on) => duck(!!on);
  // The app reports each problem once.
  window.gevOnVoiceProblem = (what) => {
    if (what === 'ai-key-refused') {
      toast('OpenAI refused the key, so the unit\'s own voice speaks until the app restarts. Check "openai" in keys.local.json.', 9000);
    } else if (what === 'no-engine') {
      toast(
        KEYS.openai
          ? 'No built-in voice on this unit, so alerts are silent when offline. Install "Speech Services by Google" from the Play Store.'
          : 'No voice on this unit. Install "Speech Services by Google" from the Play Store, or add an OpenAI key.',
        9000,
      );
    }
  };

  const hasNativeVoice = () => !!(window.GevNative && typeof window.GevNative.speak === 'function');
  const usesAiVoice = () => !!KEYS.openai && !app.isLowData();

  function say(text) {
    if (hasNativeVoice()) {
      const ai = usesAiVoice();
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
    /** kind: plate | camera | speed | redlight | trip | link */
    alert(kind, text) {
      if (settings.voice && settings[SWITCH[kind]]) say(text);
    },
    /** For the truck check, which has its own switch. */
    sayIfOn(text) {
      if (settings.voice) say(text);
    },
    sample: () => say(SAMPLE),
    stop() {
      if (hasNativeVoice()) window.GevNative.stopSpeaking();
      else if (window.speechSynthesis) window.speechSynthesis.cancel();
    },
    usesAiVoice,
  };
}
