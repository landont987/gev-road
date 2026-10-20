package com.landon.gevroad;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

// Runs with: npm run test:java (needs a JDK; set JAVA_HOME if javac is not on the PATH).
public class TileCacheTest {
    static int failures = 0;
    static void check(String name, Object got, Object want) {
        boolean same = got == null ? want == null : got.equals(want);
        if (!same) { failures++; System.out.println("FAIL " + name + ": got " + got + " want " + want); }
        else System.out.println("ok   " + name);
    }
    static byte[] bytes(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    public static void main(String[] args) throws Exception {
        check("key from a tile path", TileCache.key("/13/1545/3287.png"), "13/1545/3287");
        check("key rejects a path with dots", TileCache.key("/13/../3287.png"), null);
        check("key rejects a non tile path", TileCache.key("/about"), null);
        check("key rejects a huge zoom", TileCache.key("/99/1/1.png"), null);

        File dir = Files.createTempDirectory("gev-tiles").toFile();
        long day = 24L * 60 * 60 * 1000;
        TileCache cache = new TileCache(dir, 30 * day, 100 * 1024);
        long now = System.currentTimeMillis();

        check("miss before store", cache.fresh("13/1545/3287", now), null);
        File stored = cache.store("13/1545/3287", bytes("png-bytes"));
        check("stored file has the bytes", new String(Files.readAllBytes(stored.toPath()), StandardCharsets.UTF_8), "png-bytes");
        check("fresh after store", cache.fresh("13/1545/3287", now) != null, true);
        check("stale after 31 days", cache.fresh("13/1545/3287", now + 31 * day), null);
        check("any still finds a stale tile", cache.any("13/1545/3287") != null, true);
        check("empty bytes are not stored", cache.store("13/1/1", new byte[0]), null);

        // Prune: the cap is 100 KB; six 30 KB tiles, oldest first to go.
        TileCache small = new TileCache(Files.createTempDirectory("gev-tiles2").toFile(), 30 * day, 100 * 1024);
        byte[] tile = new byte[30 * 1024];
        for (int i = 0; i < 6; i++) {
            File f = small.store("16/" + i + "/0", tile);
            f.setLastModified(now - (6 - i) * 1000); // tile 0 is the oldest
        }
        small.prune(now);
        check("prune keeps the newest three under the cap", small.any("16/5/0") != null && small.any("16/4/0") != null && small.any("16/3/0") != null, true);
        check("prune drops the oldest", small.any("16/0/0"), null);
        check("prune drops the next oldest", small.any("16/1/0"), null);
        check("prune drops until under the cap", small.any("16/2/0"), null);

        // Prune also drops expired tiles even under the cap.
        File old = small.store("16/9/9", bytes("old"));
        old.setLastModified(now - 31 * day);
        small.prune(now);
        check("prune drops an expired tile", small.any("16/9/9"), null);

        System.out.println(failures == 0 ? "ALL PASS" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
