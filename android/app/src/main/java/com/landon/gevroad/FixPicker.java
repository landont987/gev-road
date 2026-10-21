package com.landon.gevroad;

/**
 * Which location fix to show when more than one provider talks (#64). Plain
 * Java, so scripts/test-java.sh covers it.
 *
 * A fresh GPS fix wins; another provider (network, passive) only fills in
 * while GPS has been quiet. The passive provider repeats fixes the GPS
 * listener already delivered, so a fix with the same provider and time as the
 * last one is dropped.
 */
final class FixPicker {
    /** A GPS fix younger than this keeps every other provider out. */
    static final long GPS_HOLD_MS = 10000;
    static final String GPS = "gps";

    private String lastProvider = "";
    private long lastFixTime = Long.MIN_VALUE; // the fix's own UTC time (Location.getTime)
    private long lastAcceptedAt = Long.MIN_VALUE; // the clock when it was accepted

    /**
     * @param provider the fix's own provider (Location.getProvider), "" when unknown
     * @param fixTime the fix's UTC time in ms (Location.getTime)
     * @param nowMs the clock now
     * @return true when this fix should be shown
     */
    boolean accept(String provider, long fixTime, long nowMs) {
        String name = provider == null ? "" : provider;
        if (name.equals(lastProvider) && fixTime == lastFixTime) return false; // the same fix again
        boolean gpsHeld = GPS.equals(lastProvider) && nowMs - lastAcceptedAt < GPS_HOLD_MS;
        if (!GPS.equals(name) && gpsHeld) return false;
        lastProvider = name;
        lastFixTime = fixTime;
        lastAcceptedAt = nowMs;
        return true;
    }

    String lastProvider() {
        return lastProvider;
    }

    /** Milliseconds since the last accepted fix, or -1 before the first. */
    long ageMs(long nowMs) {
        return lastAcceptedAt == Long.MIN_VALUE ? -1 : nowMs - lastAcceptedAt;
    }
}
