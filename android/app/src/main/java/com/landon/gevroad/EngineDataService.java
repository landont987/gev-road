package com.landon.gevroad;

import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;

/**
 * Receives AndrOBD's live data (see AndrobdPlugin): DATALIST and DATA arrive as
 * explicit startService calls. Their text goes to the map page through
 * EngineFeed; the page parses it. AndrOBD also binds this service, only to keep
 * GEV Road's process alive, so binding returns a plain binder.
 *
 * Android 9 lets AndrOBD start this service while GEV Road or AndrOBD is on the
 * screen; with both in the background the data stops until one comes back.
 */
public final class EngineDataService extends Service {
    private static final int MAX_TEXT_CHARS = 64 * 1024; // a full DATALIST is a few KB

    private final IBinder binder = new Binder();

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            String text = intent.getStringExtra(AndrobdPlugin.EXTRA_DATA);
            if (text != null && text.length() <= MAX_TEXT_CHARS) {
                if (AndrobdPlugin.DATA.equals(action)) EngineFeed.post(this, EngineFeed.DATA, text);
                else if (AndrobdPlugin.DATALIST.equals(action)) EngineFeed.post(this, EngineFeed.LIST, text);
            }
        }
        // Nothing to redo if Android stops it: AndrOBD sends the next change anyway.
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
}
