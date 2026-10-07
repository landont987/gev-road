package com.landon.gevroad;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
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

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * One full-screen WebView showing the bundled map page (assets/web), plus the
 * truck's GPS pushed into the page, an exact per-app data meter, spoken alerts
 * and the hotspot's online/offline state.
 */
public class MainActivity extends Activity {
    private static final String TAG = "GevRoad";
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + APP_HOST + "/assets/web/index.html";
    private static final int LOCATION_REQUEST = 1;
    private static final long GPS_INTERVAL_MS = 1000;
    // A saved fix older than this is not shown as the truck's position.
    private static final long LAST_FIX_MAX_AGE_MS = 30000;

    private WebView web;
    private RadioDrawer radio;
    private Speech speech;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkWatch;
    private Boolean lastOnline;
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
        speech = new Speech(this, new Speech.Listener() {
            @Override
            public void onSpeaking(boolean speaking) {
                runOnUiThread(() -> js("window.gevOnSpeaking&&window.gevOnSpeaking(" + speaking + ")"));
            }

            @Override
            public void onProblem(String what) {
                runOnUiThread(() -> js("window.gevOnVoiceProblem&&window.gevOnVoiceProblem(" + JSONObject.quote(what) + ")"));
            }
        });

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Debug builds only: lets Chrome DevTools inspect the page over adb.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // The OSM tile policy asks apps to identify themselves.
        settings.setUserAgentString(settings.getUserAgentString() + " GEVRoad/" + BuildConfig.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (APP_HOST.equals(url.getHost())) return false;
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
                stopGps();
                recreate();
                return true;
            }
        });
        // Page errors go to logcat (adb logcat -s GevRoad), the only place to see them on the unit.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i(TAG, "page " + message.messageLevel() + ": " + message.message()
                        + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "GevNative");

        // The map fills the screen; the radio drawer docks over its bottom part.
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        radio = new RadioDrawer(this);
        radio.setOnClosed(() -> web.evaluateJavascript("window.gevOnRadioClosed&&window.gevOnRadioClosed()", null));
        radio.setOnLayout((heightPx) -> web.evaluateJavascript(
                "window.gevOnRadioLayout&&window.gevOnRadioLayout(" + heightPx + ")", null));
        root.addView(radio.view(), radio.layoutParams());
        setContentView(root);
        web.loadUrl(START_URL);
        watchNetwork();
    }

    /** Tells the page when the hotspot connection drops or comes back (for the spoken alert). */
    private void watchNetwork() {
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkWatch = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onCapabilitiesChanged(Network net, NetworkCapabilities caps) {
                report(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            }

            @Override
            public void onLost(Network net) {
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

    /** Runs page script unless the screen is already gone (callbacks can arrive late). */
    private void js(String code) {
        if (!isDestroyed()) web.evaluateJavascript(code, null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
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
        stopGps();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopGps();
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
        web.evaluateJavascript(js, null);
    }

    /** Methods the page can call as window.GevNative.*. */
    private class Bridge {
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
         * The answer comes back through window.gevOnHttp(id, status, body).
         */
        @JavascriptInterface
        public void http(final int id, final String method, final String url, final String authorization,
                         final String contentType, final String body) {
            new Thread(() -> {
                NativeHttp.Result result = NativeHttp.request(method, url, authorization, contentType, body);
                final String js = "window.gevOnHttp&&window.gevOnHttp(" + id + "," + result.status + ","
                        + JSONObject.quote(result.body) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }, "gev-http-" + id).start();
        }

        /**
         * Like http, with any headers (a JSON object of name: value), a timeout,
         * and, with base64, the body answered as base64 text (for pictures).
         * The answer comes back through window.gevOnHttp(id, status, body).
         */
        @JavascriptInterface
        public void httpEx(final int id, final String method, final String url, final String headersJson,
                           final String body, final boolean base64, final int timeoutMs) {
            new Thread(() -> {
                NativeHttp.Result result;
                try {
                    result = NativeHttp.request(method, url, headers(headersJson), body, base64, timeoutMs);
                } catch (JSONException e) {
                    result = new NativeHttp.Result(0, "bad headers: " + e.getMessage());
                }
                final String js = "window.gevOnHttp&&window.gevOnHttp(" + id + "," + result.status + ","
                        + JSONObject.quote(result.body) + ")";
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
