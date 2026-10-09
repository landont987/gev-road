package com.landon.gevroad;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Engine data from AndrOBD (fr3ts0n/AndrOBD, GPL-3.0), a separate app on the head
 * unit that reads the truck's OBD-II adapter. GEV Road talks to it only with
 * plain Android intents, the way AndrOBD's plugins do (AndrOBD 2.4 and later);
 * it contains none of AndrOBD's code or its plugin library. The protocol, in short:
 *
 * 1. AndrOBD sends IDENTIFY (category REQUEST) straight to this receiver.
 * 2. This receiver answers with an IDENTIFY broadcast (category RESPONSE) naming
 *    GEV Road's EngineDataService and the DATA feature.
 * 3. AndrOBD lists GEV Road under Plugin manager (switched on), then starts
 *    EngineDataService with DATALIST ("mnemonic;description;value;units" lines)
 *    and DATA ("mnemonic=value", sent only when a value changes).
 *
 * This class answers step 1.
 */
public final class AndrobdPlugin extends BroadcastReceiver {
    static final String PREFIX = "com.fr3ts0n.androbd.plugin.";
    static final String IDENTIFY = PREFIX + "IDENTIFY";
    static final String DATALIST = PREFIX + "DATALIST";
    static final String DATA = PREFIX + "DATA";
    static final String REQUEST = PREFIX + "REQUEST";
    static final String RESPONSE = PREFIX + "RESPONSE";
    static final String EXTRA_DATA = PREFIX + "extra.DATA";
    private static final int FEATURE_DATA = 4; // AndrOBD sends us its live data; we send it nothing

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!IDENTIFY.equals(intent.getAction()) || !intent.hasCategory(REQUEST)) return;
        Intent answer = new Intent(IDENTIFY)
                .addCategory(RESPONSE)
                .putExtra("NAME", "GEV Road")
                .putExtra("CLASS", EngineDataService.class.getName())
                .putExtra("PACKAGE", context.getPackageName())
                .putExtra("FEATURES", FEATURE_DATA)
                .putExtra("DESCRIPTION", "Shows coolant temperature and battery voltage on the GEV Road map "
                        + "and says \"Engine running hot\" at 230°F.")
                .putExtra("COPYRIGHT", "GEV Road")
                .putExtra("LICENSE", "MIT")
                .putExtra("URL", "");
        context.sendBroadcast(answer);
        // adb logcat -s GevEngine: shows whether AndrOBD found GEV Road.
        Log.i("GevEngine", "answered AndrOBD's plugin search");
    }
}
