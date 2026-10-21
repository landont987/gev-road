package com.landon.gevroad;

/**
 * Which location fix to show when more than one provider talks (#64). Plain
 * Java, so scripts/test-java.sh covers it.
 *
 * A fresh GPS fix wins; another provider (network, passive) only fills in
 * while GPS has been quiet. The passive provider repeats fixes the GPS
 * listener already delivered: those carry the same monotonic receive-time, so
 * a fix with the same provider and receive-time as the last one is dropped.
 *
 * Identity is the fix's elapsedRealtimeNanos (monotonic since boot), never its
 * wall-clock getTime(): these head units often have a wrong clock before GPS
 * sync, which would make distinct fixes collide or a stuck clock look like one
 * endless duplicate. Monotonic time is immune to that.
 */
final class FixPicker {
    /** A GPS fix younger than this keeps every other provider out. */
    static final long GPS_HOLD_MS = 10000;
    static final String GPS = "gps";

    private String lastProvider = "";
    private long lastFixNanos = Long.MIN_VALUE; // the fix's elapsedRealtimeNanos (monotonic)
    private long lastAcceptedAt = Long.MIN_VALUE; // the monotonic clock when it was accepted

    /**
     * @param provider the fix's own provider (Location.getProvider), "" when unknown
     * @param fixNanos the fix's elapsedRealtimeNanos (monotonic, from Location.getElapsedRealtimeNanos)
     * @param nowMs SystemClock.elapsedRealtime() now (monotonic)
     * @return true when this fix should be shown
     */
    boolean accept(String provider, long fixNanos, long nowMs) {
        String name = provider == null ? "" : provider;
        // The same underlying fix again (a passive echo of a GPS fix, or a repeat).
        // fixNanos <= 0 means the fix carries no monotonic time (a quirky HAL or mock
        // provider): don't dedupe on it, or every fix after the first would be dropped.
        if (fixNanos > 0 && name.equals(lastProvider) && fixNanos == lastFixNanos) return false;
        boolean gpsHeld = GPS.equals(lastProvider) && nowMs - lastAcceptedAt < GPS_HOLD_MS;
        if (!GPS.equals(name) && gpsHeld) return false;
        lastProvider = name;
        lastFixNanos = fixNanos;
        lastAcceptedAt = nowMs;
        return true;
    }

    /** Forget the last fix: called when the watch stops, so a resume does not hold out a new provider. */
    void reset() {
        lastProvider = "";
        lastFixNanos = Long.MIN_VALUE;
        lastAcceptedAt = Long.MIN_VALUE;
    }

    String lastProvider() {
        return lastProvider;
    }

    /** Milliseconds since the last accepted fix, or -1 before the first. */
    long ageMs(long nowMs) {
        return lastAcceptedAt == Long.MIN_VALUE ? -1 : nowMs - lastAcceptedAt;
    }
}
