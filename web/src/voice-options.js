// The AI voices and accents the driver can pick, and the OpenAI speech request.
// Pure: no DOM, no network.

import { OPENAI_TTS_MODEL } from './config.js';

// gpt-4o-mini-tts built-in voices (OpenAI text-to-speech guide, checked 2026-10-07).
// OpenAI recommends marin and cedar for the best quality, so they come first.
export const VOICES = ['cedar', 'marin', 'ash', 'ballad', 'echo', 'onyx', 'verse', 'fable', 'alloy', 'coral', 'nova', 'sage', 'shimmer'];

// label: shown on the button. say: the words used in the instruction to the voice.
export const ACCENTS = [
  { id: 'american', label: 'American (none)', say: 'American' },
  { id: 'arabic-gulf', label: 'Arabic (Gulf)', say: 'Gulf Arabic' },
  { id: 'arabic-egyptian', label: 'Arabic (Egyptian)', say: 'Egyptian Arabic' },
  { id: 'arabic-levantine', label: 'Arabic (Levantine)', say: 'Levantine Arabic' },
  { id: 'mandarin', label: 'Chinese (Mandarin)', say: 'Mandarin Chinese' },
  { id: 'cantonese', label: 'Chinese (Cantonese)', say: 'Cantonese Chinese' },
  { id: 'indian', label: 'Indian', say: 'Indian' },
  { id: 'pakistani', label: 'Pakistani', say: 'Pakistani' },
  { id: 'persian', label: 'Persian', say: 'Persian' },
  { id: 'turkish', label: 'Turkish', say: 'Turkish' },
  { id: 'filipino', label: 'Filipino', say: 'Filipino' },
  { id: 'vietnamese', label: 'Vietnamese', say: 'Vietnamese' },
  { id: 'korean', label: 'Korean', say: 'Korean' },
  { id: 'japanese', label: 'Japanese', say: 'Japanese' },
  { id: 'russian', label: 'Russian', say: 'Russian' },
  { id: 'nigerian', label: 'Nigerian', say: 'Nigerian' },
  { id: 'jamaican', label: 'Jamaican', say: 'Jamaican' },
  { id: 'mexican', label: 'Mexican', say: 'Mexican Spanish' },
  { id: 'brazilian', label: 'Brazilian', say: 'Brazilian Portuguese' },
  { id: 'french', label: 'French', say: 'French' },
  { id: 'italian', label: 'Italian', say: 'Italian' },
  { id: 'german', label: 'German', say: 'German' },
  { id: 'british', label: 'British (London)', say: 'London British' },
  { id: 'irish', label: 'Irish', say: 'Irish' },
  { id: 'scottish', label: 'Scottish', say: 'Scottish' },
  { id: 'australian', label: 'Australian', say: 'Australian' },
  { id: 'southern', label: 'Southern US', say: 'Southern American' },
  { id: 'texan', label: 'Texan', say: 'Texan' },
  { id: 'newyork', label: 'New York', say: 'New York' },
  { id: 'boston', label: 'Boston', say: 'Boston' },
];

const STYLE = 'Calm, clear and friendly, like a co-driver giving a quick heads-up, easy to hear over road noise.';

export function instructionsFor(accentId) {
  const accent = ACCENTS.filter((a) => a.id === accentId)[0];
  if (!accent || accent.id === 'american') return `Speak clear American English. ${STYLE}`;
  return (
    `Speak English with a natural ${accent.say} accent. ` +
    `Keep the accent authentic and respectful, never exaggerated or comedic. ${STYLE}`
  );
}

/** JSON body for POST /v1/audio/speech. The app caches the audio by this exact text. */
export function speechBody(text, voice, accentId) {
  return JSON.stringify({
    model: OPENAI_TTS_MODEL,
    voice: VOICES.indexOf(voice) >= 0 ? voice : VOICES[0],
    input: text,
    instructions: instructionsFor(accentId),
    response_format: 'mp3',
  });
}
