package com.landon.gevroad;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * One HTTPS request made by the app itself, for APIs the WebView cannot call
 * directly (api.bcfy.io answers browser preflights with 401). Only hosts in
 * ALLOWED may be called; the page never gets a general-purpose proxy.
 * Runs on the calling thread, so callers use a background thread.
 */
final class NativeHttp {
    private static final String TAG = "GevHttp";
    private static final String[] ALLOWED = {"api.bcfy.io"};
    private static final int TIMEOUT_MS = 20000;
    private static final int MAX_BODY = 2 * 1024 * 1024;

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

    static boolean allowed(String urlText) {
        try {
            URL url = new URL(urlText);
            if (!"https".equals(url.getProtocol())) return false;
            for (String host : ALLOWED) {
                if (host.equals(url.getHost())) return true;
            }
        } catch (IOException e) {
            return false;
        }
        return false;
    }

    static Result request(String method, String urlText, String authorization, String contentType, String body) {
        if (!allowed(urlText)) return new Result(0, "refused: host not allowed");
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlText).openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "GEVRoad/" + BuildConfig.VERSION_NAME);
            conn.setRequestProperty("Accept", "application/json");
            if (authorization != null && !authorization.isEmpty()) {
                conn.setRequestProperty("Authorization", authorization);
            }
            if (body != null && !body.isEmpty()) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", contentType == null ? "application/x-www-form-urlencoded" : contentType);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return new Result(status, readAll(in));
        } catch (IOException e) {
            Log.w(TAG, method + " " + urlText + " failed", e);
            return new Result(0, "network: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
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
