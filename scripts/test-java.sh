#!/bin/sh
# Tests the plain-Java parts of the Android app (no Android needed): the
# detector's serial line splitter and the map tile cache. Needs a JDK; set
# JAVA_HOME if javac is not on the PATH.
set -e
BIN="${JAVA_HOME:+$JAVA_HOME/bin/}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
SRC=android/app/src/main/java/com/landon/gevroad
"${BIN}javac" -d "$OUT" "$SRC/LineFramer.java" "$SRC/TileCache.java" test/java/LineFramerTest.java test/java/TileCacheTest.java
"${BIN}java" -cp "$OUT" com.landon.gevroad.LineFramerTest
"${BIN}java" -cp "$OUT" com.landon.gevroad.TileCacheTest
