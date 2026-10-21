// Keeps a streamed station or scanner playing on its own (#56). A hotspot
// drop or a server closing the stream shows up as "error", "ended" or a long
// "stalled" with no data; each restarts the stream after a short wait, until
// the driver presses STOP (isCurrent() goes false). Pure, for tests.

/**
 * audio: an HTMLAudioElement (or anything with addEventListener).
 * opts: { retryMs, stallMs, isCurrent(), restart(), maxFailures?, onGiveUp?() }
 * A hotspot blip restarts forever (any successful "playing" resets the count);
 * a dead or mistyped URL never plays, so after maxFailures restarts in a row it
 * gives up and calls onGiveUp instead of retrying (and billing data) forever.
 */
export function watchStream(audio, opts) {
  let retry = null;
  let stall = null;
  let failures = 0;
  const cap = opts.maxFailures || Infinity;

  function tryRestart() {
    if (!opts.isCurrent()) return;
    failures += 1;
    if (failures > cap) {
      if (opts.onGiveUp) opts.onGiveUp();
      return;
    }
    opts.restart();
  }

  function scheduleRestart() {
    if (retry || !opts.isCurrent()) return;
    retry = setTimeout(() => {
      retry = null;
      tryRestart();
    }, opts.retryMs);
  }

  function clearStall() {
    clearTimeout(stall);
    stall = null;
  }

  audio.addEventListener('error', scheduleRestart);
  audio.addEventListener('ended', scheduleRestart);
  // Stalled means no data for a while: a slow hotspot does that too, so wait
  // the grace period, then restart at once (the wait was the delay).
  audio.addEventListener('stalled', () => {
    if (stall || !opts.isCurrent()) return;
    stall = setTimeout(() => {
      stall = null;
      clearTimeout(retry);
      retry = null;
      tryRestart();
    }, opts.stallMs);
  });
  audio.addEventListener('progress', clearStall);
  audio.addEventListener('playing', () => {
    failures = 0; // it is playing again: a later blip gets the full retry budget afresh
    clearStall();
    clearTimeout(retry);
    retry = null;
  });
}
