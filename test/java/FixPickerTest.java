package com.landon.gevroad;

/** Run with scripts/test-java.sh. Identity is the monotonic receive-time (nanos), not the clock. */
public final class FixPickerTest {
    private static int failures;

    private static void check(String name, boolean ok) {
        if (ok) return;
        failures++;
        System.err.println("FAIL: " + name);
    }

    private static final long MS = 1_000_000L; // one millisecond in nanos

    public static void main(String[] args) {
        FixPicker p = new FixPicker();
        check("no fix yet: age is -1", p.ageMs(5000) == -1);
        check("the first fix of any provider shows", p.accept("network", 1000 * MS, 1000));
        check("age counts from the accepted clock", p.ageMs(3500) == 2500);
        check("a gps fix beats the network", p.accept("gps", 2000 * MS, 2000));
        check("the last provider is gps", "gps".equals(p.lastProvider()));
        check("network waits while gps is fresh", !p.accept("network", 3000 * MS, 3000));
        check("passive echo of the gps fix (same nanos) is dropped", !p.accept("gps", 2000 * MS, 3000));
        check("a newer gps fix shows", p.accept("gps", 4000 * MS, 4000));
        check("network fills in once gps is quiet", p.accept("network", 20000 * MS, 4000 + FixPicker.GPS_HOLD_MS));
        check("gps takes over again at once", p.accept("gps", 21000 * MS, 21000));
        check("a null provider is treated as unknown", p.accept(null, 40000 * MS, 40000));
        check("unknown again with the same nanos is a repeat", !p.accept("", 40000 * MS, 40001));

        // A wrong head-unit clock cannot drop real fixes: two gps fixes with distinct
        // receive-times are both shown even if their wall-clock getTime would collide.
        FixPicker q = new FixPicker();
        check("first gps fix shows", q.accept("gps", 100 * MS, 100));
        check("a distinct gps fix one second later still shows", q.accept("gps", 1100 * MS, 1100));

        // After reset (a stop), the gps hold is forgotten so a network fix is not held out.
        FixPicker r = new FixPicker();
        check("gps accepted", r.accept("gps", 500 * MS, 500));
        check("network held out while gps is fresh", !r.accept("network", 600 * MS, 600));
        r.reset();
        check("after reset a network fix shows at once", r.accept("network", 700 * MS, 700));
        check("after reset the provider is cleared", r.lastProvider().equals("network"));

        if (failures > 0) {
            System.err.println(failures + " FixPicker check(s) failed");
            System.exit(1);
        }
        System.out.println("FixPicker: all checks passed");
    }
}
