package com.landon.gevroad;

import android.content.Context;
import android.util.Log;

import org.conscrypt.Conscrypt;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

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
    };
    private static final int TIMEOUT_MS = 20000;
    private static final int MAX_BODY = 2 * 1024 * 1024;

    private static Context appContext;
    private static OkHttpClient client;

    /** Status and body of a finished request; status 0 means it never reached the server. */
    static final class Result {
        final int status;
        final String body;

        Result(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private NativeHttp() {
    }

    /** Call once from the activity; the trust store reads res/raw through it. */
    static void init(Context context) {
        appContext = context.getApplicationContext();
    }

    static boolean allowed(String method, String urlText) {
        try {
            URL url = new URL(urlText);
            if (!"https".equals(url.getProtocol())) return false;
            for (String[] entry : ALLOWED) {
                if (!entry[0].equals(url.getHost())) continue;
                for (int i = 1; i < entry.length; i++) {
                    if (entry[i].equals(method)) return true;
                }
            }
        } catch (IOException e) {
            return false;
        }
        return false;
    }

    static Result request(String method, String urlText, String authorization, String contentType, String body) {
        if (!allowed(method, urlText)) return new Result(0, "refused: host or method not allowed");
        try {
            Request.Builder req = new Request.Builder()
                    .url(urlText)
                    .header("User-Agent", "GEVRoad/" + BuildConfig.VERSION_NAME)
                    .header("Accept", "application/json");
            if (authorization != null && !authorization.isEmpty()) req.header("Authorization", authorization);
            RequestBody payload = null;
            if (body != null && !body.isEmpty()) {
                String type = contentType == null || contentType.isEmpty()
                        ? "application/x-www-form-urlencoded" : contentType;
                payload = RequestBody.create(body.getBytes(StandardCharsets.UTF_8), MediaType.parse(type));
            }
            req.method(method, payload);
            try (Response res = client().newCall(req.build()).execute()) {
                ResponseBody resBody = res.body();
                return new Result(res.code(), readAll(resBody == null ? null : resBody.byteStream()));
            }
        } catch (IOException | GeneralSecurityException | IllegalArgumentException e) {
            Log.w(TAG, method + " " + urlText + " failed", e);
            return new Result(0, "network: " + e.getMessage());
        }
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

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) > 0) {
            buf.write(chunk, 0, n);
            if (buf.size() > MAX_BODY) throw new IOException("response over " + MAX_BODY + " bytes");
        }
        return buf.toString("UTF-8");
    }
}
