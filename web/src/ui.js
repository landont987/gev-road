// Small DOM helpers. Text always goes in through textContent, never innerHTML,
// because camera names and search results come from outside sources.

import { swipeResult, isDrag, exitTransform, dragOpacity } from './swipe-dismiss-logic.js';

export const $ = (id) => document.getElementById(id);

/** el('div', { class: 'x', onclick: fn }, 'text', childNode) */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const key of Object.keys(attrs || {})) {
    const value = attrs[key];
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

let sheetOnClose = null;
let sheetKind = null;

/** Show the left panel. Returns its body element for the caller to fill. */
export function openSheet(kind, title, onClose) {
  if (sheetOnClose) sheetOnClose();
  sheetKind = kind;
  sheetOnClose = onClose || null;
  $('sheet-title').textContent = title;
  const body = $('sheet-body');
  body.textContent = '';
  $('sheet').hidden = false;
  document.body.classList.add('sheet-open');
  return body;
}

export function closeSheet() {
  if (sheetOnClose) sheetOnClose();
  sheetOnClose = null;
  sheetKind = null;
  $('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}

export const openSheetKind = () => sheetKind;

/**
 * Let a notification be flicked away with a finger (#swipe-dismiss). The element
 * follows the drag; released past the threshold it slides off and onDismiss()
 * runs, otherwise it snaps back. Works with touch and with a mouse (the preview).
 * onDismiss must hide the element; makeSwipeable only clears its own inline styles.
 */
export function makeSwipeable(el, onDismiss) {
  let x0 = 0;
  let y0 = 0;
  let active = false;
  const SNAP = 'opacity 0.2s ease-out, transform 0.2s ease-out';

  function clearInline() {
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
  }

  function start(x, y) {
    active = true;
    x0 = x;
    y0 = y;
    el.style.transition = 'none';
  }

  function move(x, y, ev) {
    if (!active) return;
    const dx = x - x0;
    const dy = y - y0;
    if (isDrag(dx, dy) && ev && ev.cancelable) ev.preventDefault(); // don't pan the map underneath
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.opacity = String(dragOpacity(dx, dy));
  }

  function end(x, y) {
    if (!active) return;
    active = false;
    const r = swipeResult(x - x0, y - y0);
    if (r.dismiss) {
      el.style.transition = SNAP;
      el.style.transform = exitTransform(r.axis, r.dir);
      el.style.opacity = '0';
      setTimeout(() => {
        clearInline(); // reset before onDismiss hides it, so the next one shows fresh
        onDismiss();
      }, 200);
    } else {
      el.style.transition = SNAP;
      el.style.transform = '';
      el.style.opacity = '';
      setTimeout(clearInline, 200);
    }
  }

  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  el.addEventListener('touchend', (e) => { const t = (e.changedTouches && e.changedTouches[0]) || {}; end(t.clientX == null ? x0 : t.clientX, t.clientY == null ? y0 : t.clientY); });
  // Mouse too, for the computer preview; window may be a bare stub under node tests.
  el.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('mousemove', (e) => { if (active) move(e.clientX, e.clientY, e); });
    window.addEventListener('mouseup', (e) => { if (active) end(e.clientX, e.clientY); });
  }
}

let toastTimer = null;
let toastSwipeWired = false;
export function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
}

export function toast(message, ms) {
  const node = $('toast');
  if (!toastSwipeWired) {
    makeSwipeable(node, hideToast); // flick it away instead of waiting (#swipe-dismiss)
    toastSwipeWired = true;
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, ms || 3500);
}

export function setOn(button, on) {
  button.classList.toggle('on', !!on);
}

/**
 * fetch with a timeout that also covers reading the body, so a hotspot that
 * stalls mid-download never leaves a spinner forever. Returns the parts of a
 * Response the app uses: ok, status, json(), text(), arrayBuffer().
 */
export function fetchWithTimeout(url, ms, init) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  const done = (promise) =>
    Promise.race([promise, timeout]).then(
      (value) => {
        clearTimeout(timer);
        return value;
      },
      (err) => {
        clearTimeout(timer);
        throw err;
      },
    );
  const options = Object.assign({}, init, controller ? { signal: controller.signal } : {});
  return Promise.race([fetch(url, options), timeout]).then(
    (res) => ({
      ok: res.ok,
      status: res.status,
      json: () => done(res.json()),
      text: () => done(res.text()),
      arrayBuffer: () => done(res.arrayBuffer()),
    }),
    (err) => {
      clearTimeout(timer);
      throw err;
    },
  );
}
