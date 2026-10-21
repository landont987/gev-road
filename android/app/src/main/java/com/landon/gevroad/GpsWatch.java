package com.landon.gevroad;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The truck's position from every provider the unit has (#64), and the facts
 * the page needs to say why nothing arrives: the location setting, the
 * permission, which providers are on, and how many satellites the GPS sees.
 *
 * On the first drive the app listened to the GPS provider only and the map
 * sat on downtown Phoenix with "NO GPS" and nothing to go on. Now:
 *  - gps, network and passive are all listened to; FixPicker shows the best.
 *  - GnssStatus reports satellites seen and used, pushed to the page every few
 *    seconds while there is no fix.
 *  - The chip is asked for assistance data at start (force_xtra_injection,
 *    force_time_injection): a cold MediaTek fix takes minutes without it.
 *  - A last known position up to LAST_SEEN_MAX_AGE_MS old centers the map once
 *    (where the truck was parked), without being shown as a live fix.
 */
final class GpsWatch {
    interface Listener {
        /** A fix to show, with the provider's name. */
        void onFix(Location fix);

        /** Where the truck was last seen, for the start view only. */
        void onLastKnown(Location where, long ageMs);

        /** The GPS state changed (JSON for the page, see statusJson). */
        void onStatus(String json);
    }

    private static final String TAG = "GevRoad";
    private static final long INTERVAL_MS = 1000;
    /** A saved fix younger than this is shown as the truck's position at start. */
    static final long LAST_FIX_MAX_AGE_MS = 30000;
    /** A saved fix younger than this centers the map at start. */
    static final long LAST_SEEN_MAX_AGE_MS = 12L * 60 * 60 * 1000;
    /** Satellite counts change every second; the page hears about them this often. */
    private static final long STATUS_EVERY_MS = 5000;
    private static final String[] PROVIDERS = {
            LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER };
    private static final String[] ASSIST_COMMANDS = { "force_xtra_injection", "force_time_injection" };
    /** A network or passive fix rougher than this is noise next to the GPS: not shown. */
    static final float OTHER_PROVIDER_MAX_ACCURACY_M = 500f;

    private final Context ctx;
    private final LocationManager locations;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final FixPicker picker = new FixPicker();
    // Read by statusJson on a WebView thread while start/stop write it on the UI thread.
    private final List<String> listening = new CopyOnWriteArrayList<>();
    private volatile Location lastKnown; // where the truck was last seen, for the start view
    private volatile long lastKnownAgeMs;
    private boolean running;
    private boolean gnssStarted;
    private int satellites;
    private int satellitesUsed;
    private long statusSentAt = Long.MIN_VALUE;

    private final LocationListener fixes = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            if (!usable(location)) return;
            if (!picker.accept(location.getProvider(), location.getTime(), SystemClock.elapsedRealtime())) return;
            listener.onFix(location);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
            // Required on Android 9; the GNSS callback below says more.
        }

        @Override
        public void onProviderEnabled(String provider) {
            pushStatus(true);
        }

        @Override
        public void onProviderDisabled(String provider) {
            pushStatus(true);
        }
    };

    private final GnssStatus.Callback gnss = new GnssStatus.Callback() {
        @Override
        public void onStarted() {
            gnssStarted = true;
            pushStatus(true);
        }

        @Override
        public void onStopped() {
            gnssStarted = false;
            satellites = 0;
            satellitesUsed = 0;
            pushStatus(true);
        }

        @Override
        public void onSatelliteStatusChanged(GnssStatus status) {
            int seen = status.getSatelliteCount();
            int used = 0;
            for (int i = 0; i < seen; i++) {
                if (status.usedInFix(i)) used++;
            }
            satellites = seen;
            satellitesUsed = used;
            pushStatus(false);
        }
    };

    GpsWatch(Context ctx, Listener listener) {
        this.ctx = ctx;
        this.locations = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        this.listener = listener;
    }

    boolean isRunning() {
        return running;
    }

    /** Starts listening. Needs ACCESS_FINE_LOCATION granted; the caller checks. */
    @SuppressLint("MissingPermission")
    void start() {
        if (running || locations == null) return;
        running = true;
        listening.clear();
        List<String> all = locations.getAllProviders();
        for (String provider : PROVIDERS) {
            if (all == null || !all.contains(provider)) continue;
            try {
                locations.requestLocationUpdates(provider, INTERVAL_MS, 0, fixes, Looper.getMainLooper());
                listening.add(provider);
            } catch (SecurityException | IllegalArgumentException e) {
                Log.w(TAG, "location provider " + provider + " could not start", e);
            }
        }
        if (listening.isEmpty()) Log.e(TAG, "no location provider could start; providers: " + all);
        try {
            locations.registerGnssStatusCallback(gnss, main);
        } catch (RuntimeException e) {
            Log.w(TAG, "satellite status not available", e);
        }
        askForAssistance();
        pushLastKnown();
        pushStatus(true);
    }

    void stop() {
        if (!running) return;
        running = false;
        try {
            locations.removeUpdates(fixes);
        } catch (RuntimeException e) {
            Log.w(TAG, "location stop", e);
        }
        try {
            locations.unregisterGnssStatusCallback(gnss);
        } catch (RuntimeException e) {
            Log.w(TAG, "satellite status stop", e);
        }
        gnssStarted = false;
        satellites = 0;
        satellitesUsed = 0;
        listening.clear();
    }

    /** A GPS fix always; another provider only when it is close to the truth. */
    static boolean usable(Location fix) {
        if (FixPicker.GPS.equals(fix.getProvider())) return true;
        return fix.hasAccuracy() && fix.getAccuracy() <= OTHER_PROVIDER_MAX_ACCURACY_M;
    }

    /** Assistance data makes a cold fix take seconds instead of minutes. Best effort. */
    private void askForAssistance() {
        if (!listening.contains(LocationManager.GPS_PROVIDER)) return;
        for (String command : ASSIST_COMMANDS) {
            try {
                locations.sendExtraCommand(LocationManager.GPS_PROVIDER, command, null);
            } catch (RuntimeException e) {
                Log.w(TAG, "GPS extra command " + command + " refused", e);
            }
        }
    }

    @SuppressLint("MissingPermission")
    private void pushLastKnown() {
        Location best = null;
        for (String provider : listening) {
            try {
                Location last = locations.getLastKnownLocation(provider);
                if (last != null && (best == null || last.getElapsedRealtimeNanos() > best.getElapsedRealtimeNanos())) {
                    best = last;
                }
            } catch (SecurityException | IllegalArgumentException e) {
                Log.w(TAG, "last known location from " + provider, e);
            }
        }
        if (best == null || !usable(best)) return;
        long age = ageMs(best);
        if (age < LAST_FIX_MAX_AGE_MS) {
            if (picker.accept(best.getProvider(), best.getTime(), SystemClock.elapsedRealtime())) listener.onFix(best);
        } else if (age < LAST_SEEN_MAX_AGE_MS) {
            // Also kept in statusJson: at a cold start this push lands before the page exists.
            lastKnown = best;
            lastKnownAgeMs = age;
            listener.onLastKnown(best, age);
        }
    }

    static long ageMs(Location loc) {
        return (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1000000L;
    }

    private void pushStatus(boolean now) {
        long clock = SystemClock.elapsedRealtime();
        if (!now && statusSentAt != Long.MIN_VALUE && clock - statusSentAt < STATUS_EVERY_MS) return;
        statusSentAt = clock;
        listener.onStatus(statusJson(true));
    }

    private boolean locationOn() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return locations.isLocationEnabled();
        int mode = Settings.Secure.getInt(ctx.getContentResolver(), Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF);
        return mode != Settings.Secure.LOCATION_MODE_OFF;
    }

    /**
     * The GPS state for the page, as JSON:
     * {permission, locationOn, providers: [every provider the unit has], enabled: [the ones switched on],
     *  listening: [the ones this app hears], gnss: bool, satellites, used, lastProvider, lastFixAgeS,
     *  lastKnown: {lat, lon, ageS}}. lastFixAgeS is -1 before the first fix; lastKnown is absent
     * without a saved position. Called from a WebView thread too (the bridge), so it reads only
     * what is safe to read there.
     */
    String statusJson(boolean permission) {
        JSONObject out = new JSONObject();
        try {
            out.put("permission", permission);
            out.put("locationOn", locations != null && locationOn());
            JSONArray all = new JSONArray();
            JSONArray enabled = new JSONArray();
            if (locations != null) {
                List<String> providers = locations.getAllProviders();
                if (providers != null) {
                    for (String p : providers) {
                        all.put(p);
                        try {
                            if (locations.isProviderEnabled(p)) enabled.put(p);
                        } catch (RuntimeException e) {
                            Log.w(TAG, "provider state " + p, e);
                        }
                    }
                }
            }
            out.put("providers", all);
            out.put("enabled", enabled);
            out.put("listening", new JSONArray(listening));
            out.put("gnss", gnssStarted);
            out.put("satellites", satellites);
            out.put("used", satellitesUsed);
            out.put("lastProvider", picker.lastProvider());
            long age = picker.ageMs(SystemClock.elapsedRealtime());
            out.put("lastFixAgeS", age < 0 ? -1 : age / 1000);
            Location seen = lastKnown;
            if (seen != null) {
                JSONObject where = new JSONObject();
                where.put("lat", seen.getLatitude());
                where.put("lon", seen.getLongitude());
                where.put("ageS", lastKnownAgeMs / 1000);
                out.put("lastKnown", where);
            }
        } catch (JSONException | RuntimeException e) {
            Log.w(TAG, "gps status json", e);
        }
        return out.toString();
    }
}
