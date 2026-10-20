package com.landon.gevroad;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Map tiles kept on the unit (#51): one file per tile under z/x/y, served
 * while younger than maxAgeMs, kept as an offline stand-in up to three
 * times that, pruned oldest-first past maxBytes. The OSM tile policy asks
 * apps to cache tiles for at least 7 days. Plain Java, no Android, so it can
 * be tested on the computer.
 */
final class TileCache {
    static final String HOST = "tile.openstreetmap.org";
    private static final Pattern TILE_PATH = Pattern.compile("^/(\\d{1,2})/(\\d{1,7})/(\\d{1,7})\\.png$");
    private static final int MAX_ZOOM = 19;
    /** A stale tile is kept this many times maxAgeMs, so the map still shows after a month away. */
    private static final int STALE_KEEP_FACTOR = 3;
    private static final byte[] PNG_HEAD = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};

    private final File dir;
    private final long maxAgeMs;
    private final long maxBytes;

    TileCache(File dir, long maxAgeMs, long maxBytes) {
        this.dir = dir;
        this.maxAgeMs = maxAgeMs;
        this.maxBytes = maxBytes;
    }

    /** "z/x/y" from a tile URL path like /13/1545/3287.png, or null for anything else. */
    static String key(String path) {
        if (path == null) return null;
        Matcher m = TILE_PATH.matcher(path);
        if (!m.matches()) return null;
        int z = Integer.parseInt(m.group(1));
        if (z > MAX_ZOOM) return null;
        return z + "/" + Long.parseLong(m.group(2)) + "/" + Long.parseLong(m.group(3));
    }

    private File fileFor(String key) {
        return new File(dir, key + ".png");
    }

    /** The tile's file when it is on disk and younger than maxAgeMs, else null. */
    File fresh(String key, long now) {
        File f = any(key);
        if (f == null) return null;
        return now - f.lastModified() < maxAgeMs ? f : null;
    }

    /** The tile's file whatever its age (a stand-in when the network fails), else null. */
    File any(String key) {
        File f = fileFor(key);
        return f.isFile() && f.length() > 0 ? f : null;
    }

    /** Whether the bytes start like a PNG: a 200 that is not a picture must not be kept for a month. */
    static boolean isPng(byte[] bytes) {
        if (bytes == null || bytes.length < PNG_HEAD.length) return false;
        for (int i = 0; i < PNG_HEAD.length; i++) {
            if (bytes[i] != PNG_HEAD[i]) return false;
        }
        return true;
    }

    /** Saves a PNG tile (whole file or nothing). Returns the file, or null when nothing was saved. */
    File store(String key, byte[] bytes) {
        if (!isPng(bytes)) return null;
        File f = fileFor(key);
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) return null;
        File part;
        try {
            // A name of its own: two request threads may save the same tile at once.
            part = File.createTempFile(f.getName(), ".part", parent);
            try (FileOutputStream out = new FileOutputStream(part)) {
                out.write(bytes);
            }
        } catch (IOException e) {
            return null;
        }
        if (!part.renameTo(f)) {
            part.delete();
            return null;
        }
        return f;
    }

    /**
     * Drops tiles too old even as a stand-in, then the oldest until the cache
     * is under maxBytes. Call off the UI thread.
     */
    void prune(long now) {
        List<File> files = new ArrayList<>();
        collect(dir, files);
        long total = 0;
        List<File> kept = new ArrayList<>();
        for (File f : files) {
            if (f.getName().endsWith(".part") || now - f.lastModified() >= maxAgeMs * STALE_KEEP_FACTOR) {
                f.delete();
                continue;
            }
            kept.add(f);
            total += f.length();
        }
        if (total <= maxBytes) return;
        File[] oldestFirst = kept.toArray(new File[0]);
        Arrays.sort(oldestFirst, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : oldestFirst) {
            if (total <= maxBytes) break;
            total -= f.length();
            f.delete();
        }
    }

    private static void collect(File d, List<File> out) {
        File[] entries = d.listFiles();
        if (entries == null) return;
        for (File e : entries) {
            if (e.isDirectory()) collect(e, out);
            else out.add(e);
        }
    }
}
