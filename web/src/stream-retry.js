// Keeps a streamed station or scanner playing on its own (#56). A hotspot
// drop or a server closing the stream shows up as "error", "ended" or a long
// "stalled" with no data; each restarts the stream after a short wait, until
// the driver presses STOP (isCurrent() goes false). Pure, for tests.

/**
 * audio: an HTMLAudioElement (or anything with addEventListener).
 * opts: { retryMs, stallMs, isCurrent(), restart() }
 */
export function watchStream(audio, opts) {
  let retry = null;
  let stall = null;

  function scheduleRestart() {
    if (retry || !opts.isCurrent()) return;
    retry = setTimeout(() => {
      retry = null;
      if (opts.isCurrent()) opts.restart();
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
      if (opts.isCurrent()) opts.restart();
    }, opts.stallMs);
  });
  audio.addEventListener('progress', clearStall);
  audio.addEventListener('playing', () => {
    clearStall();
    clearTimeout(retry);
    retry = null;
  });
}
