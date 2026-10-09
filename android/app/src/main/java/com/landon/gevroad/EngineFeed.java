package com.landon.gevroad;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;

/**
 * Carries AndrOBD's text from EngineDataService to the map page (main thread
 * only). The last DATALIST is saved, because it says which units AndrOBD uses
 * and it may arrive while the page is not open.
 */
final class EngineFeed {
    static final String DATA = "data";
    static final String LIST = "list";
    static final String BEAT = "beat";
    private static final String PREFS = "engine";
    private static final String LAST_LIST = "lastList";
    private static final String COOLANT_UNITS = "coolantUnits";
    // The two readings the page uses. AndrOBD sends every reading in its list as it
    // changes (often many a second): the others only tell the page it is still sending.
    private static final String COOLANT = "engine_coolant_temperature=";
    private static final String VOLTS = "ecu_voltage=";
    private static final long BEAT_MS = 2000;

    interface Listener {
        void onEngine(String kind, String text);
    }

    private static Listener listener;
    private static long lastBeatAt;

    private EngineFeed() {
    }

    static void setListener(Listener l) {
        listener = l;
    }

    /** Clears the listener only if it is still this one (a recreated screen sets its own first). */
    static void clearListener(Listener l) {
        if (listener == l) listener = null;
    }

    static void post(Context context, String kind, String text) {
        if (LIST.equals(kind)) {
            prefs(context).edit().putString(LAST_LIST, text).remove(COOLANT_UNITS).apply();
        } else if (!text.startsWith(COOLANT) && !text.startsWith(VOLTS)) {
            beat();
            return;
        } else if (text.equals(COOLANT + "°F") || text.equals(COOLANT + "°C")) {
            // AndrOBD's units changed after its list was sent: kept for a reopened page.
            prefs(context).edit().putString(COOLANT_UNITS, text.substring(COOLANT.length())).apply();
        }
        if (listener != null) listener.onEngine(kind, text);
    }

    private static void beat() {
        long now = SystemClock.uptimeMillis();
        if (now - lastBeatAt < BEAT_MS) return;
        lastBeatAt = now;
        if (listener != null) listener.onEngine(BEAT, "");
    }

    /** The last DATALIST, plus a line for a units change since (the page reads the last coolant line). */
    static String lastList(Context context) {
        SharedPreferences saved = prefs(context);
        String list = saved.getString(LAST_LIST, "");
        String units = saved.getString(COOLANT_UNITS, "");
        return units.isEmpty() ? list : list + "\nengine_coolant_temperature;;;" + units;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
