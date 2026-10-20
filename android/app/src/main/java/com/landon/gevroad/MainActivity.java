package com.landon.gevroad;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.TrafficStats;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One full-screen WebView showing the bundled map page (assets/web), plus the
 * truck's GPS pushed into the page, an exact per-app data meter, spoken alerts,
 * the hotspot's online/offline state and the USB plate-reader detector.
 */
public class MainActivity extends Activity {
    private static final String TAG = "GevRoad";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/assets/web/index.html";
    private static final int LOCATION_REQUEST = 1;
    // Map tiles kept on the unit (#51): a familiar route loads from disk and survives a hotspot drop.
    private static final long TILE_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000;
    private static final long TILE_MAX_BYTES = 150L * 1024 * 1024;
    // Short: the WebView may run these fetches one after another, so a stalled hotspot must not hold the page.
    private static final int TILE_TIMEOUT_MS = 8000;
    private static final long TILE_NETWORK_PAUSE_MS = 30000; // after a failed fetch, serve stale or hand over for this long
    private static final long GPS_INTERVAL_MS = 1000;
    // A saved fix older than this is not shown as the truck's position.
    private static final long LAST_FIX_MAX_AGE_MS = 30000;
    private static final Pattern KEY_IN_URL = Pattern.compile("([?&](?:key|api_key|apikey|token))=[^&\\s\"']+");
    // Debug builds only: adb shell am broadcast -a <this> --es b64 <base64 text> feeds the detector.
    private static final String DEBUG_DETECTOR_ACTION = "com.landon.gevroad.DEBUG_DETECTOR_LINES";

    private WebView web;
    private RadioDrawer radio;
    private TileCache tiles;
    private volatile long tileNetworkPausedUntil = 0;
    private Speech speech;
    private Detector detector;
    // AndrOBD's engine data, passed to the page as it comes (see AndrobdPlugin).
    private final EngineFeed.Listener engineListener = (kind, text) ->
            js("window.gevOnEngine&&window.gevOnEngine(" + jsString(kind) + "," + jsString(text) + ")");
    private BroadcastReceiver debugDetectorLines;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkWatch;
    private Boolean lastOnline;
    private boolean everValidated;
    private boolean rendererGone;
    private LocationManager locations;
    private long rxAtStart;
    private long txAtStart;
    private boolean gpsRunning;
    private boolean askedForLocation;

    private final LocationListener gpsListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            pushLocation(location);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
            // Required on Android 9; nothing to do.
        }

        @Override
        public void onProviderEnabled(String provider) {
        }

        @Override
        public void onProviderDisabled(String provider) {
            Toast.makeText(MainActivity.this, "GPS is turned off on this unit.", Toast.LENGTH_LONG).show();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        int uid = Process.myUid();
        rxAtStart = TrafficStats.getUidRxBytes(uid);
        txAtStart = TrafficStats.getUidTxBytes(uid);
        locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        NativeHttp.init(this);
        tiles = new TileCache(new File(getCacheDir(), "tiles"), TILE_MAX_AGE_MS, TILE_MAX_BYTES);
        final TileCache toPrune = tiles;
        new Thread(() -> toPrune.prune(System.currentTimeMillis()), "tile-prune").start();
        speech = new Speech(this, new Speech.Listener() {
            @Override
            public void onSpeaking(boolean speaking) {
                runOnUiThread(() -> js("window.gevOnSpeaking&&window.gevOnSpeaking(" + speaking + ")"));
            }

            @Override
            public void onProblem(String what) {
                runOnUiThread(() -> js("window.gevOnVoiceProblem&&window.gevOnVoiceProblem(" + jsString(what) + ")"));
            }
        });

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Debug builds only: lets Chrome DevTools inspect the page over adb.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        // Our own page only: live calls start a few seconds after the tap, when
        // each call arrives, which a "tap first" rule blocks. The drawer of
        // outside pages (RadioDrawer) still needs a tap.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The OSM tile policy asks apps to identify themselves.
        settings.setUserAgentString(settings.getUserAgentString() + " GEVRoad/" + BuildConfig.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse tile = tileResponse(request);
                if (tile != null) return tile;
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                // Authority, not host: "evil\\@appassets..." must not pass as our own page.
                String raw = url.toString();
                if ("https".equals(url.getScheme()) && APP_HOST.equals(url.getAuthority())
                        && raw.indexOf('\\') < 0) return false;
                // Credit links open in the unit's browser, never inside the map.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (RuntimeException e) {
                    Log.w(TAG, "No browser for " + url, e);
                }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Low memory can kill the page's process. Returning true keeps the app
                // alive; the dead WebView cannot be reused, so rebuild the screen.
                Log.e(TAG, "map page process gone (crashed=" + detail.didCrash() + "), restarting the screen");
                rendererGone = true; // this WebView must not be used again
                stopGps();
                recreate();
                return true;
            }
        });
        // Page errors go to logcat (adb logcat -s GevRoad), the only place to see them on the unit.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                // Network errors print the full URL, and some carry a key (?key=...).
                String text = KEY_IN_URL.matcher(message.message()).replaceAll("$1=REDACTED");
                String source = KEY_IN_URL.matcher(message.sourceId()).replaceAll("$1=REDACTED");
                Log.i(TAG, "page " + message.messageLevel() + ": " + text
                        + " (" + source + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "GevNative");

        // The map fills the screen; the radio drawer docks over its bottom part.
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        radio = new RadioDrawer(this);
        radio.setOnClosed(() -> js("window.gevOnRadioClosed&&window.gevOnRadioClosed()"));
        radio.setOnLayout((heightPx) -> js(
                "window.gevOnRadioLayout&&window.gevOnRadioLayout(" + heightPx + ")"));
        root.addView(radio.view(), radio.layoutParams());
        setContentView(root);
        web.loadUrl(START_URL);
        watchNetwork();
        startDetector();
        EngineFeed.setListener(engineListener);
    }

    /** The plate-reader detector's lines and state go to the page as they come. */
    private void startDetector() {
        detector = new Detector(this, new Detector.Listener() {
            @Override
            public void onLine(String line) {
                js("window.gevOnDetectorLine&&window.gevOnDetectorLine(" + jsString(line) + ")");
            }

            @Override
            public void onState(String stateJson) {
                js("window.gevOnDetectorState&&window.gevOnDetectorState(" + jsString(stateJson) + ")");
            }
        });
        // start() finds a board that is already plugged in, including when the
        // "plugged in" alias opened the app.
        detector.start();
        if (BuildConfig.DEBUG) {
            // The emulator has no USB: this feeds the same path a board's bytes take.
            debugDetectorLines = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String b64 = intent.getStringExtra("b64");
                    if (b64 == null) return;
                    try {
                        detector.injectForTest(new String(Base64.decode(b64, Base64.DEFAULT), StandardCharsets.UTF_8));
                    } catch (IllegalArgumentException e) {
                        Log.w(TAG, "debug detector lines: not base64");
                    }
                }
            };
            // Only senders holding DUMP (adb's shell has it; ordinary apps cannot) may use it.
            IntentFilter filter = new IntentFilter(DEBUG_DETECTOR_ACTION);
            String dumpOnly = android.Manifest.permission.DUMP;
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                registerReceiver(debugDetectorLines, filter, dumpOnly, null, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(debugDetectorLines, filter, dumpOnly, null);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Opened again because the detector was plugged in (the auto-open alias is on). Android
        // grants the permission with this launch, possibly after its plug-in broadcast arrived.
        // Not kept with setIntent: a rebuilt screen must not replay an old plug-in.
        if (detector != null) detector.onLaunchIntent(intent);
    }

    /** Tells the page when the hotspot connection drops or comes back (for the spoken alert). */
    private void watchNetwork() {
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkWatch = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network net, NetworkCapabilities caps) {
                boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                // Some head units never pass Android's internet check. Until one has,
                // a network that is there counts as online; only a lost one is offline.
                if (validated) everValidated = true;
                report(everValidated ? validated : true);
            }

            @Override
            public void onLost(Network net) {
                // everValidated stays: the truck always rejoins the same phone hotspot, so a
                // return without validation (the phone has no data) is still offline.
                report(false);
            }

            private void report(boolean online) {
                runOnUiThread(() -> {
                    if (lastOnline != null && lastOnline == online) return;
                    lastOnline = online;
                    js("window.gevOnNetwork&&window.gevOnNetwork(" + online + ")");
                });
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkWatch);
        } catch (RuntimeException e) {
            Log.w(TAG, "cannot watch the network", e);
            networkWatch = null;
        }
    }

    /**
     * Text as a JavaScript string literal. JSONObject.quote leaves U+2028 and U+2029
     * as they are, and JavaScript before Chrome 66 ends a string at either one.
     */
    static String jsString(String text) {
        return JSONObject.quote(text).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }

    /** Runs page script unless the screen or its page process is gone (callbacks can arrive late). */
    private void js(String code) {
        if (!isDestroyed() && !rendererGone) web.evaluateJavascript(code, null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // The page keeps running in the background; it must not call the stopped GPS "lost".
        js("window.gevOnAppVisible&&window.gevOnAppVisible(true)");
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            startGps();
        } else if (!askedForLocation) {
            // Ask once per launch: after "Deny", onResume runs again and must not re-ask in a loop.
            askedForLocation = true;
            requestPermissions(new String[] {Manifest.permission.ACCESS_FINE_LOCATION}, LOCATION_REQUEST);
        }
    }

    @Override
    protected void onPause() {
        js("window.gevOnAppVisible&&window.gevOnAppVisible(false)");
        stopGps();
        radio.pause();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopGps();
        if (debugDetectorLines != null) unregisterReceiver(debugDetectorLines);
        detector.stop();
        EngineFeed.clearListener(engineListener);
        if (networkWatch != null) connectivity.unregisterNetworkCallback(networkWatch);
        speech.shutdown();
        radio.destroy();
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != LOCATION_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            startGps();
        } else {
            Toast.makeText(this, "Without location the map cannot follow the truck.", Toast.LENGTH_LONG).show();
        }
    }

    private void startGps() {
        if (gpsRunning || locations == null) return;
        try {
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, GPS_INTERVAL_MS, 0, gpsListener);
            gpsRunning = true;
            Location last = locations.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last != null && ageMs(last) < LAST_FIX_MAX_AGE_MS) pushLocation(last);
        } catch (SecurityException | IllegalArgumentException e) {
            Log.e(TAG, "GPS could not start", e);
            Toast.makeText(this, "This unit's GPS could not start.", Toast.LENGTH_LONG).show();
        }
    }

    private void stopGps() {
        if (!gpsRunning) return;
        locations.removeUpdates(gpsListener);
        gpsRunning = false;
    }

    private static long ageMs(Location loc) {
        return (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1000000L;
    }

    private void pushLocation(Location loc) {
        String js = String.format(Locale.US,
                "window.gevOnLocation&&window.gevOnLocation(%.7f,%.7f,%.2f,%.1f,%.1f)",
                loc.getLatitude(),
                loc.getLongitude(),
                loc.hasSpeed() ? loc.getSpeed() : -1f,
                loc.hasBearing() ? loc.getBearing() : -1f,
                loc.hasAccuracy() ? loc.getAccuracy() : -1f);
        js(js);
    }

    /** Methods the page can call as window.GevNative.*. */
    private class Bridge {
        /** AndrOBD's last DATALIST (it names the units), or "" before the first one. */
        @JavascriptInterface
        public String engineList() {
            return EngineFeed.lastList(MainActivity.this);
        }

        /** The plate-reader detector: { state, problem, lines, autoOpen, usbHost } as JSON. */
        @JavascriptInterface
        public String detectorStatus() {
            return detector.stateJson();
        }

        /** Ask Android for USB permission for the detector (the page only offers this while parked). */
        @JavascriptInterface
        public void detectorConnect() {
            runOnUiThread(() -> detector.connect());
        }

        /** Open GEV Road when the detector is plugged in (and let Android remember the permission). */
        @JavascriptInterface
        public void detectorAutoOpen(final boolean on) {
            runOnUiThread(() -> detector.setAutoOpen(on));
        }

        /** Show a scanner page (Broadcastify or OpenMHz only) in the radio drawer. */
        @JavascriptInterface
        public void radioOpen(String url, String name) {
            runOnUiThread(() -> radio.open(url, name == null ? "Radio" : name));
        }

        /** Unload the scanner page and hide the drawer. */
        @JavascriptInterface
        public void radioClose() {
            runOnUiThread(() -> radio.close());
        }

        /**
         * One HTTPS request made by the app for the page (hosts limited in NativeHttp).
         * The answer comes back through window.gevOnHttp(id, status, body, ageSeconds).
         */
        @JavascriptInterface
        public void http(final int id, final String method, final String url, final String authorization,
                         final String contentType, final String body) {
            new Thread(() -> {
                NativeHttp.Result result;
                try {
                    result = NativeHttp.request(method, url, authorization, contentType, body);
                } catch (RuntimeException e) {
                    Log.e(TAG, "request crashed", e);
                    result = new NativeHttp.Result(0, "app error: " + e.getClass().getSimpleName());
                }
                final String js = "window.gevOnHttp&&window.gevOnHttp(" + id + "," + result.status + ","
                        + jsString(result.body) + "," + result.ageSeconds + ")";
                runOnUiThread(() -> js(js));
            }, "gev-http-" + id).start();
        }

        /**
         * Like http, with any headers (a JSON object of name: value), a timeout,
         * and, with base64, the body answered as base64 text (for pictures).
         * The answer comes back through window.gevOnHttp(id, status, body, ageSeconds).
         */
        @JavascriptInterface
        public void httpEx(final int id, final String method, final String url, final String headersJson,
                           final String body, final boolean base64, final int timeoutMs) {
            new Thread(() -> {
                NativeHttp.Result result;
                try {
                    result = NativeHttp.request(method, url, headers(headersJson), body, base64, timeoutMs);
                } catch (JSONException e) {
                    result = new NativeHttp.Result(0, "refused: bad headers");
                } catch (RuntimeException e) {
                    Log.e(TAG, "request crashed", e);
                    result = new NativeHttp.Result(0, "app error: " + e.getClass().getSimpleName());
                }
                final String js = "window.gevOnHttp&&window.gevOnHttp(" + id + "," + result.status + ","
                        + jsString(result.body) + "," + result.ageSeconds + ")";
                runOnUiThread(() -> js(js));
            }, "gev-http-" + id).start();
        }

        /**
         * Speak an alert. With aiUrl, aiKey and aiBody (an OpenAI speech request)
         * the AI voice speaks; with empty strings, the unit's own voice.
         */
        @JavascriptInterface
        public void speak(String text, String aiUrl, String aiKey, String aiBody) {
            speech.say(text, orEmpty(aiUrl), orEmpty(aiKey), orEmpty(aiBody));
        }

        @JavascriptInterface
        public void stopSpeaking() {
            speech.stop();
        }

        /** Whether the network has working internet right now (the page asks once at startup). */
        @JavascriptInterface
        public boolean isOnline() {
            return speech.isOnline();
        }

        /** Bytes this app has sent and received since it opened, or -1 if the unit does not report it. */
        @JavascriptInterface
        public long dataBytes() {
            int uid = Process.myUid();
            long rx = TrafficStats.getUidRxBytes(uid);
            long tx = TrafficStats.getUidTxBytes(uid);
            if (rx == TrafficStats.UNSUPPORTED || tx == TrafficStats.UNSUPPORTED || rxAtStart < 0 || txAtStart < 0) {
                return -1;
            }
            return (rx - rxAtStart) + (tx - txAtStart);
        }

        /**
         * Memory for the menu's MEMORY line, as JSON {app, processes, free, total, low}:
         * this app's PSS in bytes summed over every process Android lists for it
         * (the WebView renderer included when it is listed), how many that is, and
         * the unit's free and total memory. app is -1 when the unit does not report it.
         */
        @JavascriptInterface
        public String memoryJson() {
            return memoryInfoJson();
        }
    }

    private String memoryInfoJson() {
        JSONObject out = new JSONObject();
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            long app = -1;
            int count = 0;
            if (am != null) {
                java.util.List<ActivityManager.RunningAppProcessInfo> running = am.getRunningAppProcesses();
                if (running != null && !running.isEmpty()) {
                    int[] pids = new int[running.size()];
                    for (int i = 0; i < pids.length; i++) pids[i] = running.get(i).pid;
                    android.os.Debug.MemoryInfo[] infos = am.getProcessMemoryInfo(pids);
                    if (infos != null) {
                        app = 0;
                        for (android.os.Debug.MemoryInfo info : infos) {
                            if (info == null) continue;
                            app += info.getTotalPss() * 1024L;
                            count++;
                        }
                    }
                }
                ActivityManager.MemoryInfo unit = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(unit);
                out.put("free", unit.availMem);
                out.put("total", unit.totalMem);
                out.put("low", unit.lowMemory);
            }
            out.put("app", app);
            out.put("processes", count);
        } catch (JSONException | RuntimeException e) {
            Log.w(TAG, "memory info failed", e);
            return "null";
        }
        return out.toString();
    }

    /**
     * An OpenStreetMap tile from the unit's own cache (#51), fetched and saved
     * when missing or older than 30 days; a stale copy stands in when the
     * network fails. Null lets the WebView fetch it the usual way. Runs on the
     * WebView's own request threads, so a blocking fetch is fine here.
     */
    private WebResourceResponse tileResponse(WebResourceRequest request) {
        Uri url = request.getUrl();
        if (!"GET".equals(request.getMethod()) || !"https".equals(url.getScheme())
                || !TileCache.HOST.equals(url.getHost())) return null;
        String key = TileCache.key(url.getPath());
        if (key == null) return null;
        try {
            long now = System.currentTimeMillis();
            File cached = tiles.fresh(key, now);
            if (cached != null) return tileFile(cached);
            if (now >= tileNetworkPausedUntil) {
                Map<String, String> headers = new LinkedHashMap<>();
                headers.put("Accept", "image/png");
                NativeHttp.BytesResult res = NativeHttp.requestBytes("GET", url.toString(), headers, null, TILE_TIMEOUT_MS);
                if (res.status == 200 && TileCache.isPng(res.body)) {
                    tiles.store(key, res.body);
                    return new WebResourceResponse("image/png", null, new ByteArrayInputStream(res.body));
                }
                // One failure pauses tile fetches for a while, so a dead hotspot cannot hold every tile for 8 s each.
                if (res.status == 0) tileNetworkPausedUntil = System.currentTimeMillis() + TILE_NETWORK_PAUSE_MS;
            }
            File stale = tiles.any(key);
            if (stale != null) return tileFile(stale);
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "tile " + key + " failed", e);
        }
        return null;
    }

    private static WebResourceResponse tileFile(File file) throws IOException {
        return new WebResourceResponse("image/png", null, new FileInputStream(file));
    }

    private static String orEmpty(String text) {
        return text == null ? "" : text;
    }

    private static Map<String, String> headers(String json) throws JSONException {
        Map<String, String> map = new LinkedHashMap<>();
        if (json == null || json.isEmpty()) return map;
        JSONObject obj = new JSONObject(json);
        for (Iterator<String> names = obj.keys(); names.hasNext(); ) {
            String name = names.next();
            map.put(name, obj.getString(name));
        }
        return map;
    }
}
