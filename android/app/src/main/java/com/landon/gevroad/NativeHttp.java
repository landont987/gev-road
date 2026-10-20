package com.landon.gevroad;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.conscrypt.Conscrypt;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * One HTTPS request made by the app itself, for servers the WebView cannot use:
 *  - api.bcfy.io answers browser preflights with 401, so the page cannot send
 *    its Authorization header.
 *  - routing.openstreetmap.de only speaks TLS 1.3. Android 9 and its 2018
 *    WebView stop at TLS 1.2, so requests go through Conscrypt (Google's TLS
 *    library, bundled) via OkHttp, which turn TLS 1.3 on.
 *  - api.openai.com (spoken alerts, see Speech) and generativelanguage.googleapis.com (the AI
 *    truck check) take the driver's keys in headers the page should not have
 *    to send cross-origin.
 *  - overpass-api.de (speed and red-light cameras) also only speaks TLS 1.3.
 *  - az511.com camera pictures: scripted requests get two
 *    Access-Control-Allow-Origin values, which browsers reject, so the AI truck
 *    check fetches the picture bytes here.
 * Trust is Android's own roots plus ISRG Root X2 (res/raw), which Android 9
 * lacks and Let's Encrypt's newer certificates chain to.
 * Only the host and method pairs in ALLOWED may be called; the page never gets
 * a general-purpose proxy. Runs on the calling thread, so callers use a
 * background thread.
 */
final class NativeHttp {
    private static final String TAG = "GevHttp";
    /** host, then the methods allowed for it. */
    private static final String[][] ALLOWED = {
            {"api.bcfy.io", "GET", "POST"},
            {"routing.openstreetmap.de", "GET"},
            {"api.openai.com", "POST"},
            {"generativelanguage.googleapis.com", "POST"},
            {"az511.com", "GET"},
            {"overpass-api.de", "GET"},
            {TileCache.HOST, "GET"}, // map tiles for the unit's own cache (MainActivity.tileResponse)
    };
    private static final int TIMEOUT_MS = 20000;
    private static final int MAX_TIMEOUT_MS = 90000;
    /** The only request headers the page may set (lower case). */
    private static final Set<String> HEADERS = new HashSet<>(Arrays.asList(
            "authorization", "x-goog-api-key", "content-type", "accept"));
    private static final int MAX_BODY = 4 * 1024 * 1024; // AZ511 closures: about 2.4 MB unzipped

    private static Context appContext;
    private static OkHttpClient client;

    /** Status and body of a finished request; status 0 means it never reached the server. */
    static final class Result {
        final int status;
        final String body;
        /** The Age header in seconds (how long a cache has held the answer), or -1. */
        final int ageSeconds;

        Result(int status, String body) {
            this(status, body, -1);
        }

        Result(int status, String body, int ageSeconds) {
            this.status = status;
            this.body = body;
            this.ageSeconds = ageSeconds;
        }
    }

    /** The same, with the body as raw bytes (pictures, audio). */
    static final class BytesResult {
        final int status;
        final byte[] body;
        final int ageSeconds;

        BytesResult(int status, byte[] body) {
            this(status, body, -1);
        }

        BytesResult(int status, byte[] body, int ageSeconds) {
            this.status = status;
            this.body = body;
            this.ageSeconds = ageSeconds;
        }
    }

    private NativeHttp() {
    }

    /** Call once from the activity; the trust store reads res/raw through it. */
    static void init(Context context) {
        appContext = context.getApplicationContext();
    }

    /**
     * The parsed URL when this host and method may be called, else null. The
     * request uses this same parsed URL, so the check and the connection can
     * never disagree about the host (java.net.URL and OkHttp read a backslash
     * differently).
     */
    static HttpUrl allowedUrl(String method, String urlText) {
        HttpUrl url = urlText == null ? null : HttpUrl.parse(urlText);
        if (url == null || !url.isHttps() || url.port() != 443) return null;
        if (!url.username().isEmpty() || !url.password().isEmpty()) return null;
        for (String[] entry : ALLOWED) {
            if (!entry[0].equals(url.host())) continue;
            for (int i = 1; i < entry.length; i++) {
                if (entry[i].equals(method)) return url;
            }
        }
        return null;
    }

    static Result request(String method, String urlText, String authorization, String contentType, String body) {
        Map<String, String> headers = new LinkedHashMap<>();
        if (authorization != null && !authorization.isEmpty()) headers.put("Authorization", authorization);
        if (contentType != null && !contentType.isEmpty()) headers.put("Content-Type", contentType);
        return request(method, urlText, headers, body, false, TIMEOUT_MS);
    }

    /** Any headers; with base64 the body comes back as base64 text (for pictures). */
    static Result request(String method, String urlText, Map<String, String> headers, String body,
                          boolean base64, int timeoutMs) {
        byte[] payload = body == null || body.isEmpty() ? null : body.getBytes(StandardCharsets.UTF_8);
        BytesResult raw = requestBytes(method, urlText, headers, payload, timeoutMs);
        if (raw.status == 0 || !base64) {
            return new Result(raw.status, new String(raw.body, StandardCharsets.UTF_8), raw.ageSeconds);
        }
        return new Result(raw.status, Base64.encodeToString(raw.body, Base64.NO_WRAP), raw.ageSeconds);
    }

    static BytesResult requestBytes(String method, String urlText, Map<String, String> headers, byte[] body,
                                    int timeoutMs) {
        HttpUrl url = allowedUrl(method, urlText);
        if (url == null) return failed("refused: host or method not allowed");
        try {
            Request.Builder req = new Request.Builder()
                    .url(url)
                    .header("User-Agent", "GEVRoad/" + BuildConfig.VERSION_NAME)
                    .header("Accept", "application/json");
            String contentType = "application/x-www-form-urlencoded";
            for (Map.Entry<String, String> h : headers.entrySet()) {
                String name = h.getKey().toLowerCase(Locale.US);
                if (!HEADERS.contains(name)) return failed("refused: header " + h.getKey() + " not allowed");
                if ("content-type".equals(name)) contentType = h.getValue();
                else req.header(h.getKey(), h.getValue());
            }
            RequestBody payload = body == null ? null : RequestBody.create(body, MediaType.parse(contentType));
            req.method(method, payload);
            try (Response res = client(timeoutMs).newCall(req.build()).execute()) {
                ResponseBody resBody = res.body();
                return new BytesResult(res.code(), readAll(resBody == null ? null : resBody.byteStream()),
                        ageSeconds(res.header("Age")));
            }
        } catch (IllegalArgumentException e) {
            // OkHttp's message can repeat a bad header's value, which may be a key: never log it.
            Log.w(TAG, method + " " + url.host() + " refused a bad request (" + e.getClass().getSimpleName() + ")");
            return failed("refused: a header or the body is not valid");
        } catch (IOException | GeneralSecurityException e) {
            Log.w(TAG, method + " " + url.host() + " failed", e);
            return failed("network: " + e.getMessage());
        }
    }

    /** A cache's Age header in whole seconds, or -1 when missing or not a number. */
    static int ageSeconds(String header) {
        if (header == null) return -1;
        try {
            int age = Integer.parseInt(header.trim());
            return age < 0 ? -1 : age;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static BytesResult failed(String why) {
        return new BytesResult(0, why.getBytes(StandardCharsets.UTF_8));
    }

    /** The shared client, or a copy with longer timeouts (an AI answer can take a while). */
    private static OkHttpClient client(int timeoutMs) throws GeneralSecurityException, IOException {
        int ms = Math.max(1000, Math.min(MAX_TIMEOUT_MS, timeoutMs));
        if (ms == TIMEOUT_MS) return client();
        return client().newBuilder()
                .connectTimeout(Math.min(ms, TIMEOUT_MS), TimeUnit.MILLISECONDS)
                .readTimeout(ms, TimeUnit.MILLISECONDS)
                .writeTimeout(ms, TimeUnit.MILLISECONDS)
                .callTimeout(ms, TimeUnit.MILLISECONDS)
                .build();
    }

    private static synchronized OkHttpClient client() throws GeneralSecurityException, IOException {
        if (client != null) return client;
        X509TrustManager trust = trustManager();
        SSLContext tls = SSLContext.getInstance("TLS", Conscrypt.newProvider());
        tls.init(null, new TrustManager[] {trust}, null);
        client = new OkHttpClient.Builder()
                .sslSocketFactory(tls.getSocketFactory(), trust)
                .connectTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .readTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .writeTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .callTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .build();
        return client;
    }

    /** Android's own roots plus ISRG Root X2. */
    private static X509TrustManager trustManager() throws GeneralSecurityException, IOException {
        if (appContext == null) throw new GeneralSecurityException("NativeHttp.init was not called");
        KeyStore roots = KeyStore.getInstance(KeyStore.getDefaultType());
        roots.load(null, null);
        KeyStore system = KeyStore.getInstance("AndroidCAStore");
        system.load(null, null);
        for (String alias : Collections.list(system.aliases())) {
            roots.setCertificateEntry(alias, system.getCertificate(alias));
        }
        try (InputStream in = appContext.getResources().openRawResource(R.raw.isrg_root_x2)) {
            roots.setCertificateEntry("gevroad-isrg-root-x2",
                    CertificateFactory.getInstance("X.509").generateCertificate(in));
        }
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(roots);
        for (TrustManager manager : factory.getTrustManagers()) {
            if (manager instanceof X509TrustManager) return (X509TrustManager) manager;
        }
        throw new GeneralSecurityException("no X509 trust manager");
    }

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) {
            buf.write(chunk, 0, n);
            if (buf.size() > MAX_BODY) throw new IOException("response over " + MAX_BODY + " bytes");
        }
        return buf.toByteArray();
    }
}
