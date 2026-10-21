#!/bin/sh
# Tests the plain-Java parts of the Android app (no Android needed): the
# detector's serial line splitter, the map tile cache and the GPS fix picker. Needs a JDK; set
# JAVA_HOME if javac is not on the PATH.
set -e
BIN="${JAVA_HOME:+$JAVA_HOME/bin/}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
SRC=android/app/src/main/java/com/landon/gevroad
"${BIN}javac" -d "$OUT" "$SRC/LineFramer.java" "$SRC/TileCache.java" "$SRC/FixPicker.java" test/java/LineFramerTest.java test/java/TileCacheTest.java test/java/FixPickerTest.java
"${BIN}java" -cp "$OUT" com.landon.gevroad.LineFramerTest
"${BIN}java" -cp "$OUT" com.landon.gevroad.TileCacheTest
"${BIN}java" -cp "$OUT" com.landon.gevroad.FixPickerTest
