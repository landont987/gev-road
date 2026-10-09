package com.landon.gevroad;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

// Runs with: npm run test:java (needs a JDK; set JAVA_HOME if javac is not on the PATH).
public class LineFramerTest {
    static int failures = 0;
    static void check(String name, Object got, Object want) {
        if (!got.equals(want)) { failures++; System.out.println("FAIL " + name + ": got " + got + " want " + want); }
        else System.out.println("ok   " + name);
    }
    static List<String> feedAll(LineFramer f, String... chunks) {
        List<String> out = new ArrayList<>();
        for (String c : chunks) { byte[] b = c.getBytes(StandardCharsets.UTF_8); out.addAll(f.feed(b, b.length)); }
        return out;
    }
    public static void main(String[] args) {
        check("one line", feedAll(new LineFramer(64), "{\"a\":1}\n"), List.of("{\"a\":1}"));
        check("CRLF trimmed", feedAll(new LineFramer(64), "abc\r\n"), List.of("abc"));
        check("split across reads", feedAll(new LineFramer(64), "{\"ev", "ent\":1}", "\n"), List.of("{\"event\":1}"));
        check("two in one read", feedAll(new LineFramer(64), "a\nb\n"), List.of("a", "b"));
        check("partial waits", feedAll(new LineFramer(64), "no newline yet"), List.of());
        check("blank lines skipped", feedAll(new LineFramer(64), "\n\r\n\nx\n"), List.of("x"));
        check("too long dropped whole, next kept", feedAll(new LineFramer(8), "0123456789abc\nok\n"), List.of("ok"));
        check("exactly the limit kept", feedAll(new LineFramer(8), "01234567\n"), List.of("01234567"));
        check("too long across reads", feedAll(new LineFramer(8), "0123456", "789", "xyz\nok\n"), List.of("ok"));
        check("utf8 split mid-character", feedAll(new LineFramer(64), "café".substring(0, 3), "é\n"), List.of("café"));
        byte[] e = "café\n".getBytes(StandardCharsets.UTF_8);
        LineFramer f = new LineFramer(64);
        List<String> out = new ArrayList<>(f.feed(e, 4)); // ends inside the two-byte é
        out.addAll(f.feed(new byte[] {e[4], e[5]}, 2));
        check("utf8 bytes split mid-character", out, List.of("café"));
        byte[] big = new byte[] {'a', 'b', '\n', 'c', 'd'};
        check("count limits the bytes read", new LineFramer(64).feed(big, 2), List.of());
        System.out.println(failures == 0 ? "ALL PASS" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
