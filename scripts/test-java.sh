#!/bin/sh
# Tests the plain-Java parts of the Android app (no Android needed): the
# detector's serial line splitter. Needs a JDK; set JAVA_HOME if javac is not on the PATH.
set -e
BIN="${JAVA_HOME:+$JAVA_HOME/bin/}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
"${BIN}javac" -d "$OUT" android/app/src/main/java/com/landon/gevroad/LineFramer.java test/java/LineFramerTest.java
"${BIN}java" -cp "$OUT" com.landon.gevroad.LineFramerTest
