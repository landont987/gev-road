package com.landon.gevroad;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Spoken alerts, one at a time on a background thread.
 *  - A clip already cached for this exact OpenAI request plays, online or not.
 *  - Otherwise, with an OpenAI key and internet, a new clip is fetched, cached
 *    and played. A repeated alert costs no data and no money.
 *  - Otherwise, or if that fails: the unit's own text-to-speech voice.
 * Audio plays as navigation guidance and asks other audio to duck, only while
 * something is actually playing.
 */
final class Speech {
    private static final String TAG = "GevSpeech";
    private static final int AI_TIMEOUT_MS = 6000; // a late alert is worse than a robotic one
    private static final long AI_PAUSE_MS = 60000; // after a timeout or a busy server, skip the AI voice this long
    private static final long CLIP_MAX_MS = 20000;
    private static final long ENGINE_WAIT_MS = 3000;
    private static final int KEEP_NEWEST = 3; // when alerts pile up, only the newest three still play
    private static final long STALE_MS = 10000; // an alert that waited longer than this is skipped
    private static final int MAX_CACHED_CLIPS = 300;
    private static final int MAX_PLAY_FAILURES = 3; // clips this unit cannot play: stop paying for them
    private static final Pattern ERROR_CODE = Pattern.compile("\"code\"\\s*:\\s*\"([a-z_]+)\"");
    private static final AudioAttributes GUIDANCE = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    interface Listener {
        /** Called on the speech thread when speaking starts and stops. */
        void onSpeaking(boolean speaking);

        /**
         * Called once per problem per app run:
         *  no-engine, no-english, tts-failed: the unit's own voice cannot speak;
         *  ai-key-refused, ai-out-of-credit, ai-request-rejected, ai-audio-failed:
         *  the AI voice is off until the app restarts.
         */
        void onProblem(String what);
    }

    private final Listener listener;
    private final AudioManager audio;
    private final ConnectivityManager network;
    private final File clips;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicLong newest = new AtomicLong();
    private final AtomicInteger generation = new AtomicInteger();
    private final CountDownLatch engineReady = new CountDownLatch(1);
    private final Map<String, CountDownLatch> utterances = new LinkedHashMap<>();
    private final Set<String> reported = new HashSet<>();
    private final TextToSpeech engine;
    private volatile boolean engineOk;
    private boolean languageChecked; // speech thread only
    private int playFailures; // speech thread only
    private volatile boolean aiOff;
    private volatile long aiPausedUntil;
    private volatile MediaPlayer playing;
    private volatile CountDownLatch waiting;

    Speech(Context context, Listener listener) {
        Context app = context.getApplicationContext();
        this.listener = listener;
        audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        network = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        clips = new File(app.getCacheDir(), "voice");
        // onInit can run inside this constructor when no engine exists, so it only records the result.
        engine = new TextToSpeech(app, (status) -> {
            engineOk = status == TextToSpeech.SUCCESS;
            engineReady.countDown();
        });
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {
            }

            @Override
            public void onDone(String id) {
                finishUtterance(id);
            }

            @Override
            public void onError(String id) {
                Log.w(TAG, "the built-in voice failed to speak");
                report("tts-failed");
                finishUtterance(id);
            }

            @Override
            public void onError(String id, int errorCode) {
                Log.w(TAG, "the built-in voice failed to speak (error " + errorCode + ")");
                report("tts-failed");
                finishUtterance(id);
            }

            @Override
            public void onStop(String id, boolean interrupted) {
                finishUtterance(id);
            }
        });
    }

    /**
     * Say text. aiBody is the OpenAI speech request (its cached clip is used
     * when present); aiUrl and aiKey allow fetching a new clip. Empty strings
     * mean "not available".
     */
    void say(String text, String aiUrl, String aiKey, String aiBody) {
        if (text == null || text.isEmpty()) return;
        if (BuildConfig.DEBUG) Log.i(TAG, "say: " + text); // adb logcat -s GevSpeech
        final long mine = newest.incrementAndGet();
        final int gen = generation.get();
        final long queuedAt = SystemClock.elapsedRealtime();
        worker.execute(() -> {
            try {
                if (gen != generation.get()) return;
                if (newest.get() - mine >= KEEP_NEWEST) {
                    Log.w(TAG, "skipping an alert: newer ones are waiting");
                    return;
                }
                if (SystemClock.elapsedRealtime() - queuedAt > STALE_MS) {
                    Log.w(TAG, "skipping an alert that waited too long");
                    return;
                }
                speakNow(text, aiUrl, aiKey, aiBody, gen);
            } catch (RuntimeException e) {
                Log.e(TAG, "speaking failed", e); // never take the app down for one alert
            }
        });
    }

    /** Drop everything waiting and cut off what is playing. */
    void stop() {
        generation.incrementAndGet();
        MediaPlayer p = playing;
        if (p != null) {
            try {
                p.stop();
            } catch (IllegalStateException e) {
                // Already finished.
            }
        }
        engine.stop();
        CountDownLatch w = waiting;
        if (w != null) w.countDown();
    }

    void shutdown() {
        stop();
        worker.shutdownNow();
        engine.shutdown();
    }

    /**
     * True when connected to a network that offers internet. Not "validated":
     * some head units never pass Android's internet check, and a failed request
     * is handled anyway. Also used by the page (AI truck check, startup state).
     */
    boolean isOnline() {
        Network active = network.getActiveNetwork();
        NetworkCapabilities caps = active == null ? null : network.getNetworkCapabilities(active);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void speakNow(String text, String aiUrl, String aiKey, String aiBody, int gen) {
        File clip = aiBody.isEmpty() ? null : cachedClip(aiBody);
        boolean mayFetch = !aiKey.isEmpty() && !aiOff && SystemClock.elapsedRealtime() >= aiPausedUntil;
        if (clip == null && mayFetch && isOnline()) clip = fetchClip(aiUrl, aiKey, aiBody);
        if (gen != generation.get()) return;
        if (clip != null && playWithFocus(clip)) return;
        if (gen != generation.get()) return;
        speakBuiltIn(text);
    }

    private File cachedClip(String body) {
        File clip = new File(clips, sha256(body) + ".mp3");
        if (!clip.isFile() || clip.length() == 0) return null;
        clip.setLastModified(System.currentTimeMillis());
        return clip;
    }

    /** A new clip from OpenAI, saved to the cache; null on any failure. */
    private File fetchClip(String url, String key, String body) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + key);
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "audio/mpeg");
        NativeHttp.BytesResult res = NativeHttp.requestBytes(
                "POST", url, headers, body.getBytes(StandardCharsets.UTF_8), AI_TIMEOUT_MS);
        if (res.status == 0) {
            if (new String(res.body, StandardCharsets.UTF_8).startsWith("refused:")) {
                // The app itself refused it (say, a stray character in the key): retrying cannot help.
                Log.w(TAG, "AI voice request refused by the app");
                turnAiOff("ai-request-rejected");
                return null;
            }
            Log.w(TAG, "AI voice unreachable; the built-in voice speaks for a minute");
            aiPausedUntil = SystemClock.elapsedRealtime() + AI_PAUSE_MS;
            return null;
        }
        if (res.status != 200 || res.body.length == 0) {
            // OpenAI's error text repeats part of the key, so only its code is logged.
            Matcher m = ERROR_CODE.matcher(new String(res.body, StandardCharsets.UTF_8));
            String code = m.find() ? m.group(1) : "";
            Log.w(TAG, "AI voice failed (HTTP " + res.status + (code.isEmpty() ? "" : ", " + code) + ")");
            if (res.status == 401 || res.status == 403) turnAiOff("ai-key-refused");
            else if ("insufficient_quota".equals(code)) turnAiOff("ai-out-of-credit");
            else if (res.status == 400 || res.status == 404) turnAiOff("ai-request-rejected");
            else aiPausedUntil = SystemClock.elapsedRealtime() + AI_PAUSE_MS; // rate limit or server trouble
            return null;
        }
        File clip = new File(clips, sha256(body) + ".mp3");
        if (!clips.isDirectory() && !clips.mkdirs()) {
            Log.w(TAG, "cannot create the voice clip folder");
            return null;
        }
        File part = new File(clips, clip.getName() + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(res.body);
        } catch (IOException e) {
            Log.w(TAG, "could not save a voice clip", e);
            part.delete();
            return null;
        }
        if (!part.renameTo(clip)) {
            Log.w(TAG, "could not store a voice clip");
            part.delete();
            return null;
        }
        prune(clip);
        return clip;
    }

    private void turnAiOff(String why) {
        aiOff = true;
        report(why);
    }

    /** Keeps the newest clips. Never deletes keep: a unit with a wrong clock can date it "oldest". */
    private void prune(File keep) {
        File[] files = clips.listFiles((dir, name) -> name.endsWith(".mp3") && !name.equals(keep.getName()));
        if (files == null || files.length < MAX_CACHED_CLIPS) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (int i = 0; i <= files.length - MAX_CACHED_CLIPS; i++) files[i].delete();
    }

    /** Duck other audio, play, restore. False when the clip would not play (caller falls back). */
    private boolean playWithFocus(File clip) {
        if (!clip.isFile()) return false; // gone from the cache: not the unit's fault, so not a play failure
        AudioFocusRequest focus = focusRequest();
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "audio focus refused (a phone call?); skipping this alert");
            return true;
        }
        listener.onSpeaking(true);
        try {
            if (play(clip)) {
                playFailures = 0;
                return true;
            }
            if (++playFailures >= MAX_PLAY_FAILURES) turnAiOff("ai-audio-failed");
            return false;
        } finally {
            audio.abandonAudioFocusRequest(focus);
            listener.onSpeaking(false);
        }
    }

    private static AudioFocusRequest focusRequest() {
        return new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(GUIDANCE)
                .build();
    }

    private boolean play(File clip) {
        CountDownLatch done = new CountDownLatch(1);
        boolean[] failed = {false};
        MediaPlayer p = new MediaPlayer();
        try {
            p.setAudioAttributes(GUIDANCE);
            p.setDataSource(clip.getPath());
            p.setOnCompletionListener((mp) -> done.countDown());
            p.setOnErrorListener((mp, what, extra) -> {
                Log.w(TAG, "voice clip failed while playing (" + what + "/" + extra + ")");
                failed[0] = true;
                done.countDown();
                return true;
            });
            p.prepare();
            playing = p;
            waiting = done;
            p.start();
            if (!done.await(CLIP_MAX_MS, TimeUnit.MILLISECONDS)) Log.w(TAG, "voice clip ran too long");
        } catch (IOException | IllegalStateException e) {
            Log.w(TAG, "could not play a voice clip", e);
            failed[0] = true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            waiting = null;
            playing = null;
            p.release();
        }
        if (failed[0]) clip.delete(); // fetch it fresh next time
        return !failed[0];
    }

    private void speakBuiltIn(String text) {
        try {
            if (!engineReady.await(ENGINE_WAIT_MS, TimeUnit.MILLISECONDS)) {
                Log.w(TAG, "the built-in voice is still starting; skipping this alert");
                return;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (!engineOk) {
            Log.w(TAG, "this unit has no working text-to-speech engine");
            report("no-engine");
            return;
        }
        if (!languageChecked) {
            languageChecked = true;
            if (engine.setLanguage(Locale.US) < TextToSpeech.LANG_AVAILABLE) {
                Log.w(TAG, "the built-in voice has no US English");
                report("no-english");
            }
        }
        AudioFocusRequest focus = focusRequest();
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "audio focus refused (a phone call?); skipping this alert");
            return;
        }
        listener.onSpeaking(true);
        String id = "gev-" + System.nanoTime();
        CountDownLatch done = new CountDownLatch(1);
        synchronized (utterances) {
            utterances.put(id, done);
        }
        try {
            engine.setAudioAttributes(GUIDANCE);
            if (engine.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) {
                Log.w(TAG, "the built-in voice refused an alert");
                report("tts-failed");
                return;
            }
            waiting = done;
            done.await(CLIP_MAX_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            waiting = null;
            synchronized (utterances) {
                utterances.remove(id);
            }
            audio.abandonAudioFocusRequest(focus);
            listener.onSpeaking(false);
        }
    }

    private void finishUtterance(String id) {
        CountDownLatch done;
        synchronized (utterances) {
            done = utterances.remove(id);
        }
        if (done != null) done.countDown();
    }

    private void report(String what) {
        synchronized (reported) {
            if (!reported.add(what)) return;
        }
        listener.onProblem(what);
    }

    private static String sha256(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format(Locale.US, "%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
