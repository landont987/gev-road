package com.landon.gevroad;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Splits a serial byte stream into text lines. A line longer than the limit is
 * dropped whole (up to its newline), so a garbled stream cannot grow memory.
 * Plain Java, no Android, so it can be tested on the computer.
 */
final class LineFramer {
    private final byte[] line;
    private int length;
    private boolean overflowed;

    LineFramer(int maxBytes) {
        line = new byte[maxBytes];
    }

    /** The complete lines in these bytes; a partial line waits for the next call. */
    List<String> feed(byte[] bytes, int count) {
        List<String> lines = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            byte b = bytes[i];
            if (b == '\n') {
                int end = length;
                if (end > 0 && line[end - 1] == '\r') end--;
                if (!overflowed && end > 0) lines.add(new String(line, 0, end, StandardCharsets.UTF_8));
                length = 0;
                overflowed = false;
            } else if (overflowed) {
                // Skip the rest of a line that was too long.
            } else if (length == line.length) {
                overflowed = true;
                length = 0;
            } else {
                line[length++] = b;
            }
        }
        return lines;
    }
}
