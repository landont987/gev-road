package com.landon.gevroad;

/** Run with scripts/test-java.sh. */
public final class FixPickerTest {
    private static int failures;

    private static void check(String name, boolean ok) {
        if (ok) return;
        failures++;
        System.err.println("FAIL: " + name);
    }

    public static void main(String[] args) {
        FixPicker p = new FixPicker();
        check("no fix yet: age is -1", p.ageMs(5000) == -1);
        check("the first fix of any provider shows", p.accept("network", 1000, 1000));
        check("age counts from the accepted clock", p.ageMs(3500) == 2500);
        check("a gps fix beats the network", p.accept("gps", 2000, 2000));
        check("the last provider is gps", "gps".equals(p.lastProvider()));
        check("network waits while gps is fresh", !p.accept("network", 3000, 3000));
        check("passive repeat of the gps fix is dropped", !p.accept("gps", 2000, 3000));
        check("a newer gps fix shows", p.accept("gps", 4000, 4000));
        check("network fills in once gps is quiet", p.accept("network", 20000, 4000 + FixPicker.GPS_HOLD_MS));
        check("gps takes over again at once", p.accept("gps", 21000, 21000));
        check("a null provider is treated as unknown", p.accept(null, 40000, 40000));
        check("unknown again with the same time is a repeat", !p.accept("", 40000, 40001));

        if (failures > 0) {
            System.err.println(failures + " FixPicker check(s) failed");
            System.exit(1);
        }
        System.out.println("FixPicker: all checks passed");
    }
}
