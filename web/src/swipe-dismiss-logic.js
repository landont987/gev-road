// Deciding whether a drag on a notification was a "swipe it away" gesture, and
// which way it left. Pure, so node tests cover it; the DOM wiring lives in
// ui.js (makeSwipeable). The card and the toast both use this.

/** A drag must cover at least this many pixels to count as a dismiss. */
export const SWIPE_DISMISS_PX = 55;
/** Below this the drag is a tap, not a swipe (the card's tap handler still fires). */
export const SWIPE_TAP_PX = 8;

/**
 * dx, dy: pixels moved from where the finger went down.
 * Returns { dismiss, axis: 'x'|'y'|null, dir: -1|0|1 }: dismiss when the drag
 * cleared the threshold, on its dominant axis and direction.
 */
export function swipeResult(dx, dy, minPx = SWIPE_DISMISS_PX) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < minPx) return { dismiss: false, axis: null, dir: 0 };
  if (ax >= ay) return { dismiss: true, axis: 'x', dir: dx < 0 ? -1 : 1 };
  return { dismiss: true, axis: 'y', dir: dy < 0 ? -1 : 1 };
}

/** Whether a drag moved far enough to be a swipe at all (vs a tap). */
export function isDrag(dx, dy, tapPx = SWIPE_TAP_PX) {
  return Math.abs(dx) > tapPx || Math.abs(dy) > tapPx;
}

/** Where to fling the element so it leaves the screen in the swipe direction. */
export function exitTransform(axis, dir) {
  if (axis === 'x') return `translateX(${dir * 640}px)`;
  if (axis === 'y') return `translateY(${dir * 360}px)`;
  return 'translateY(-360px)';
}

/** Opacity while dragging: fades toward 0.2 as the drag approaches the threshold. */
export function dragOpacity(dx, dy, minPx = SWIPE_DISMISS_PX) {
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  return Math.max(0.2, 1 - dist / (minPx * 4));
}
