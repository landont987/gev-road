package com.landon.gevroad;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Spoken alerts, one at a time on a background thread.
 *  - With an OpenAI key and internet: the AI voice. Each clip is cached by its
 *    exact request, so a repeated alert costs no data and no money.
 *  - Otherwise, or if the AI voice fails or is slow: the unit's own
 *    text-to-speech voice.
 * Audio plays as navigation guidance and asks other audio to duck.
 */
final class Speech {
    private static final String TAG = "GevSpeech";
    private static final int AI_TIMEOUT_MS = 6000; // a late alert is worse than a robotic one
    private static final long CLIP_MAX_MS = 20000;
    private static final long ENGINE_WAIT_MS = 3000;
    private static final int MAX_QUEUED = 3; // older alerts are stale by the time these play
    private static final int MAX_CACHED_CLIPS = 300;
    private static final Pattern ERROR_CODE = Pattern.compile("\"code\"\\s*:\\s*\"([a-z_]+)\"");
    private static final AudioAttributes GUIDANCE = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    interface Listener {
        /** Called on the speech thread when speaking starts and stops. */
        void onSpeaking(boolean speaking);

        /**
         * Called once per problem: "no-engine" (the unit has no working built-in
         * voice) or "ai-key-refused" (OpenAI said 401/403; the AI voice is off
         * until the app restarts).
         */
        void onProblem(String what);
    }

    private final Listener listener;
    private final AudioManager audio;
    private final ConnectivityManager network;
    private final File clips;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger queued = new AtomicInteger();
    private final AtomicInteger generation = new AtomicInteger();
    private final CountDownLatch engineReady = new CountDownLatch(1);
    private final Map<String, CountDownLatch> utterances = new LinkedHashMap<>();
    private final TextToSpeech engine;
    private volatile boolean engineOk;
    private volatile boolean reportedNoEngine;
    private volatile boolean aiRefused;
    private volatile MediaPlayer playing;

    Speech(Context context, Listener listener) {
        Context app = context.getApplicationContext();
        this.listener = listener;
        audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        network = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        clips = new File(app.getCacheDir(), "voice");
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
                finishUtterance(id);
            }
        });
    }

    /**
     * Say text. aiUrl/aiKey/aiBody describe the OpenAI request; empty strings
     * mean "use the built-in voice".
     */
    void say(String text, String aiUrl, String aiKey, String aiBody) {
        if (text == null || text.isEmpty()) return;
        Log.i(TAG, "say: " + text); // adb logcat -s GevSpeech shows every alert
        if (queued.get() >= MAX_QUEUED) {
            Log.w(TAG, "dropping a stale alert: " + text);
            return;
        }
        queued.incrementAndGet();
        final int mine = generation.get();
        worker.execute(() -> {
            try {
                if (mine == generation.get()) speakNow(text, aiUrl, aiKey, aiBody);
            } finally {
                queued.decrementAndGet();
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
    }

    void shutdown() {
        stop();
        worker.shutdownNow();
        engine.shutdown();
    }

    private void speakNow(String text, String aiUrl, String aiKey, String aiBody) {
        listener.onSpeaking(true);
        AudioFocusRequest focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(GUIDANCE)
                .build();
        audio.requestAudioFocus(focus);
        try {
            boolean spoken = false;
            if (!aiRefused && !aiKey.isEmpty() && !aiBody.isEmpty() && online()) {
                File clip = aiClip(aiUrl, aiKey, aiBody);
                if (clip != null) spoken = play(clip);
            }
            if (!spoken) speakBuiltIn(text);
        } finally {
            audio.abandonAudioFocusRequest(focus);
            listener.onSpeaking(false);
        }
    }

    private boolean online() {
        Network active = network.getActiveNetwork();
        NetworkCapabilities caps = active == null ? null : network.getNetworkCapabilities(active);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    /** The cached clip for this exact request, or a fresh one from OpenAI; null on any failure. */
    private File aiClip(String url, String key, String body) {
        File clip = new File(clips, sha256(body) + ".mp3");
        if (clip.isFile() && clip.length() > 0) {
            clip.setLastModified(System.currentTimeMillis());
            return clip;
        }
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + key);
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "audio/mpeg");
        NativeHttp.BytesResult res = NativeHttp.requestBytes(
                "POST", url, headers, body.getBytes(StandardCharsets.UTF_8), AI_TIMEOUT_MS);
        if (res.status != 200 || res.body.length == 0) {
            // OpenAI's error text repeats part of the key, so only its code is logged.
            Matcher code = ERROR_CODE.matcher(new String(res.body, StandardCharsets.UTF_8));
            Log.w(TAG, "AI voice failed (HTTP " + res.status + (code.find() ? ", " + code.group(1) : "") + ")");
            if ((res.status == 401 || res.status == 403) && !aiRefused) {
                aiRefused = true;
                listener.onProblem("ai-key-refused");
            }
            return null;
        }
        if (!clips.isDirectory() && !clips.mkdirs()) return null;
        File part = new File(clips, clip.getName() + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(res.body);
        } catch (IOException e) {
            Log.w(TAG, "could not save a voice clip", e);
            part.delete();
            return null;
        }
        if (!part.renameTo(clip)) return null;
        prune();
        return clip;
    }

    private void prune() {
        File[] files = clips.listFiles((dir, name) -> name.endsWith(".mp3"));
        if (files == null || files.length <= MAX_CACHED_CLIPS) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (int i = 0; i < files.length - MAX_CACHED_CLIPS; i++) files[i].delete();
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
                failed[0] = true;
                done.countDown();
                return true;
            });
            p.prepare();
            playing = p;
            p.start();
            if (!done.await(CLIP_MAX_MS, TimeUnit.MILLISECONDS)) Log.w(TAG, "voice clip ran too long");
            return !failed[0];
        } catch (IOException | IllegalStateException e) {
            Log.w(TAG, "could not play a voice clip; deleting it", e);
            clip.delete();
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return true;
        } finally {
            playing = null;
            p.release();
        }
    }

    private void speakBuiltIn(String text) {
        try {
            engineReady.await(ENGINE_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return;
        }
        if (!engineOk) {
            if (!reportedNoEngine) {
                reportedNoEngine = true;
                Log.w(TAG, "this unit has no working text-to-speech engine");
                listener.onProblem("no-engine");
            }
            return;
        }
        String id = "gev-" + System.nanoTime();
        CountDownLatch done = new CountDownLatch(1);
        synchronized (utterances) {
            utterances.put(id, done);
        }
        engine.setAudioAttributes(GUIDANCE);
        engine.setLanguage(Locale.US);
        if (engine.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) {
            finishUtterance(id);
            return;
        }
        try {
            done.await(CLIP_MAX_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        synchronized (utterances) {
            utterances.remove(id);
        }
    }

    private void finishUtterance(String id) {
        CountDownLatch done;
        synchronized (utterances) {
            done = utterances.remove(id);
        }
        if (done != null) done.countDown();
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
