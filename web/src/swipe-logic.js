// How smooth the last swipe was (#65): frame times sampled while a finger
// drags the map, turned into one line for the menu. Pure, for tests.

/** Frame times (ms) -> { frames, fps, worstMs }, or null with nothing sampled. */
export function swipeStats(frameMs) {
  const frames = (frameMs || []).filter((ms) => Number.isFinite(ms) && ms > 0);
  if (!frames.length) return null;
  const total = frames.reduce((sum, ms) => sum + ms, 0);
  return {
    frames: frames.length,
    fps: Math.round((1000 * frames.length) / total),
    worstMs: Math.round(Math.max(...frames)),
  };
}

/**
 * The menu's SCREEN line. screen: { width, height, ratio } from the page;
 * stats: swipeStats() of the last drag or null; dots: DOM markers drawn now.
 */
export function screenText(screen, stats, dots) {
  const parts = [`Screen ${screen.width}x${screen.height} at ${Number(screen.ratio || 1).toFixed(2)}x.`];
  parts.push(`${dots} dots drawn.`);
  if (stats) parts.push(`Last swipe: ${stats.fps} fps over ${stats.frames} frames, worst frame ${stats.worstMs} ms.`);
  else parts.push('No swipe measured yet: drag the map, then open this menu.');
  return parts.join(' ');
}
