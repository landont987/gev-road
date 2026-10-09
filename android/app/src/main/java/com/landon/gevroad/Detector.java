package com.landon.gevroad;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The plate-reader detector: a flock-you board (MIT, colonelpanichacks/flock-you)
 * on a Seeed XIAO ESP32-S3, plugged into the head unit's USB. The board listens
 * for Flock cameras' radio signals by itself and prints one JSON line per hit over
 * its built-in USB serial port (CDC-ACM). This class only reads those lines and
 * hands them to the page; it never sends the board a command.
 *
 * USB permission: the driver taps CONNECT while parked and Android asks. With
 * "open GEV Road when the detector is plugged in" on (an activity alias that is
 * off until the driver turns it on), Android can remember the answer.
 * Everything here runs on the main thread except the reading thread.
 */
final class Detector {
    interface Listener {
        /** One line from the board that looks like JSON (main thread). */
        void onLine(String line);

        /** The state changed (main thread). */
        void onState(String stateJson);
    }

    private static final String TAG = "GevDetector";
    static final int ESPRESSIF_VENDOR_ID = 0x303A;
    private static final String ACTION_PERMISSION = "com.landon.gevroad.DETECTOR_PERMISSION";
    private static final String AUTO_OPEN_ALIAS = "com.landon.gevroad.DetectorPlugged";
    private static final int MAX_LINE_BYTES = 2048; // the board's lines are about 300 bytes
    private static final int READ_BUFFER_BYTES = 4096;
    private static final int READ_TIMEOUT_MS = 500;
    private static final int CONTROL_TIMEOUT_MS = 1000;
    private static final long QUICK_FAIL_MS = 50; // a read failing this fast did not wait for data
    private static final int MAX_QUICK_FAILS = 20; // in a row: the board is gone
    // CDC-ACM class requests (USB CDC PSTN spec).
    private static final int REQUEST_TYPE_CLASS_OUT = 0x21;
    private static final int SET_LINE_CODING = 0x20;
    private static final int SET_CONTROL_LINE_STATE = 0x22;
    // DTR and RTS on together, like a serial terminal. RTS on with DTR off resets an ESP32-S3.
    private static final int DTR_AND_RTS = 0x03;
    // 115200 baud (little endian), 1 stop bit, no parity, 8 data bits. The board ignores it; it is polite.
    private static final byte[] LINE_CODING_115200_8N1 = {0x00, (byte) 0xC2, 0x01, 0x00, 0x00, 0x00, 0x08};

    static final String NONE = "none";
    static final String NEEDS_PERMISSION = "permission";
    static final String LISTENING = "listening";
    static final String FAILED = "failed";

    private final Context context;
    private final UsbManager usb;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LineFramer testFramer = new LineFramer(MAX_LINE_BYTES);
    private Reader reader;
    private boolean started;
    // Read by the page's bridge thread through stateJson().
    private volatile String state = NONE;
    private volatile String problem = "";
    private volatile int lineCount;

    private final BroadcastReceiver usbEvents = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (device == null || device.getVendorId() != ESPRESSIF_VENDOR_ID) return;
            String action = intent.getAction();
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                if (reader != null && reader.device.getDeviceName().equals(device.getDeviceName())) {
                    reader.finish();
                    reader = null;
                }
                setState(NONE, "");
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                useBoard(device);
            } else if (ACTION_PERMISSION.equals(action)) {
                // Any app can send this broadcast on Android 9, so Android itself is asked.
                if (usb.hasPermission(device)) open(device);
                else setState(NEEDS_PERMISSION, "Permission was not given. Park and tap CONNECT to ask again.");
            }
        }
    };

    Detector(Context context, Listener listener) {
        this.context = context;
        this.usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        this.listener = listener;
    }

    /** Watch for the board and read it if Android already allows it. */
    void start() {
        if (started || usb == null) return;
        started = true;
        IntentFilter filter = new IntentFilter();
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        filter.addAction(ACTION_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(usbEvents, filter, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(usbEvents, filter);
        UsbDevice board = findBoard();
        if (board != null) useBoard(board);
    }

    void stop() {
        if (!started) return;
        started = false;
        context.unregisterReceiver(usbEvents);
        if (reader != null) reader.finish();
        reader = null;
    }

    /** The CONNECT button: ask Android for permission, or start reading if it is already given. */
    void connect() {
        if (usb == null) {
            setState(FAILED, "This unit has no USB host support.");
            return;
        }
        UsbDevice board = findBoard();
        if (board == null) {
            setState(NONE, "No detector is plugged in.");
            return;
        }
        if (usb.hasPermission(board)) {
            open(board);
            return;
        }
        Intent answer = new Intent(ACTION_PERMISSION).setPackage(context.getPackageName());
        // Android 12+ fills in the answer, so the intent must be mutable; Android 9 has no such flag.
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        usb.requestPermission(board, PendingIntent.getBroadcast(context, 0, answer, flags));
    }

    /** The app was opened because the board was plugged in (the alias is on). */
    void onLaunchIntent(Intent intent) {
        if (intent == null || !UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction())) return;
        UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
        if (device != null && device.getVendorId() == ESPRESSIF_VENDOR_ID) useBoard(device);
    }

    boolean autoOpen() {
        return context.getPackageManager().getComponentEnabledSetting(new ComponentName(context, AUTO_OPEN_ALIAS))
                == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    void setAutoOpen(boolean on) {
        context.getPackageManager().setComponentEnabledSetting(
                new ComponentName(context, AUTO_OPEN_ALIAS),
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
        setState(state, problem);
    }

    /** Safe from any thread (the page's bridge calls it). */
    String stateJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("problem", problem);
            o.put("lines", lineCount);
            o.put("autoOpen", autoOpen());
            o.put("usbHost", context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST));
        } catch (JSONException e) {
            Log.w(TAG, "state", e);
        }
        return o.toString();
    }

    /** Debug builds: text as if the board had sent it, for the emulator (it has no USB). */
    void injectForTest(String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        deliver(testFramer.feed(bytes, bytes.length));
    }

    private void useBoard(UsbDevice device) {
        if (usb.hasPermission(device)) open(device);
        else setState(NEEDS_PERMISSION, "");
    }

    private UsbDevice findBoard() {
        for (UsbDevice device : usb.getDeviceList().values()) {
            if (device.getVendorId() == ESPRESSIF_VENDOR_ID && findInterface(device, UsbConstants.USB_CLASS_CDC_DATA) != null) {
                return device;
            }
        }
        return null;
    }

    private static UsbInterface findInterface(UsbDevice device, int interfaceClass) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            if (candidate.getInterfaceClass() != interfaceClass) continue;
            if (interfaceClass != UsbConstants.USB_CLASS_CDC_DATA || bulkIn(candidate) != null) return candidate;
        }
        return null;
    }

    private static UsbEndpoint bulkIn(UsbInterface data) {
        for (int i = 0; i < data.getEndpointCount(); i++) {
            UsbEndpoint ep = data.getEndpoint(i);
            if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_IN) return ep;
        }
        return null;
    }

    private void open(UsbDevice device) {
        if (reader != null) {
            if (reader.device.getDeviceName().equals(device.getDeviceName())) return; // already reading it
            reader.finish();
            reader = null;
        }
        UsbInterface data = findInterface(device, UsbConstants.USB_CLASS_CDC_DATA);
        if (data == null) {
            setState(FAILED, "This USB device is not a serial board.");
            return;
        }
        UsbDeviceConnection connection;
        try {
            connection = usb.openDevice(device);
        } catch (SecurityException e) {
            setState(NEEDS_PERMISSION, "");
            return;
        }
        if (connection == null) {
            setState(FAILED, "Android would not open the detector. Unplug it and plug it back in.");
            return;
        }
        if (!connection.claimInterface(data, true)) {
            connection.close();
            setState(FAILED, "Another app is using the detector.");
            return;
        }
        UsbInterface comm = findInterface(device, UsbConstants.USB_CLASS_COMM);
        if (comm != null && connection.claimInterface(comm, true)) {
            int index = comm.getId();
            if (connection.controlTransfer(REQUEST_TYPE_CLASS_OUT, SET_LINE_CODING, 0, index,
                    LINE_CODING_115200_8N1, LINE_CODING_115200_8N1.length, CONTROL_TIMEOUT_MS) < 0) {
                Log.w(TAG, "the board did not take the line coding");
            }
            if (connection.controlTransfer(REQUEST_TYPE_CLASS_OUT, SET_CONTROL_LINE_STATE, DTR_AND_RTS, index,
                    null, 0, CONTROL_TIMEOUT_MS) < 0) {
                Log.w(TAG, "the board did not take DTR");
            }
        } else {
            comm = null;
        }
        reader = new Reader(device, connection, data, comm, bulkIn(data));
        reader.start();
        setState(LISTENING, "");
    }

    /** The reading thread gave up while the board was still listed. */
    private void lost(Reader gone) {
        if (reader != gone) return;
        reader = null;
        UsbDevice board = findBoard();
        setState(board == null ? NONE : FAILED,
                board == null ? "" : "The detector stopped answering. Unplug it and plug it back in.");
    }

    /** Hands JSON-looking lines to the page; other lines are the board's notes to a terminal. */
    private void deliver(List<String> lines) {
        final List<String> json = new ArrayList<>();
        for (String line : lines) {
            if (line.startsWith("{")) json.add(line);
        }
        if (json.isEmpty()) return;
        main.post(() -> {
            for (String line : json) {
                lineCount++;
                listener.onLine(line);
            }
        });
    }

    private void setState(String newState, String newProblem) {
        state = newState;
        problem = newProblem == null ? "" : newProblem;
        listener.onState(stateJson());
    }

    /** One open board. Its thread owns the connection and closes it when done. */
    private final class Reader extends Thread {
        final UsbDevice device;
        private final UsbDeviceConnection connection;
        private final UsbInterface data;
        private final UsbInterface comm;
        private final UsbEndpoint in;
        private volatile boolean running = true;

        Reader(UsbDevice device, UsbDeviceConnection connection, UsbInterface data, UsbInterface comm, UsbEndpoint in) {
            super("gev-detector");
            this.device = device;
            this.connection = connection;
            this.data = data;
            this.comm = comm;
            this.in = in;
        }

        void finish() {
            running = false;
        }

        @Override
        public void run() {
            LineFramer framer = new LineFramer(MAX_LINE_BYTES);
            byte[] buffer = new byte[READ_BUFFER_BYTES];
            int quickFails = 0;
            try {
                while (running) {
                    long before = SystemClock.uptimeMillis();
                    int count = connection.bulkTransfer(in, buffer, buffer.length, READ_TIMEOUT_MS);
                    if (count > 0) {
                        quickFails = 0;
                        deliver(framer.feed(buffer, count));
                    } else if (count < 0 && SystemClock.uptimeMillis() - before < QUICK_FAIL_MS) {
                        // A timeout waits READ_TIMEOUT_MS; failing at once means the board is gone.
                        if (++quickFails >= MAX_QUICK_FAILS) {
                            if (running) main.post(() -> lost(this));
                            break;
                        }
                        SystemClock.sleep(QUICK_FAIL_MS);
                    } else {
                        quickFails = 0; // waited and nothing came: normal between detections
                    }
                }
            } catch (RuntimeException e) {
                Log.w(TAG, "reading stopped", e);
                if (running) main.post(() -> lost(this));
            } finally {
                connection.releaseInterface(data);
                if (comm != null) connection.releaseInterface(comm);
                connection.close();
            }
        }
    }
}
