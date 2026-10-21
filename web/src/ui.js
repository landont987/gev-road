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
export function makeSwipeable(el, onDismiss, getToken) {
  let x0 = 0;
  let y0 = 0;
  let active = false;
  let token = null;
  let pending = null; // the 200 ms exit/snap-back timer, cancelled if a new drag starts
  const SNAP = 'opacity 0.2s ease-out, transform 0.2s ease-out';

  function clearInline() {
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
  }

  function start(x, y) {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    active = true;
    x0 = x;
    y0 = y;
    token = getToken ? getToken() : null; // which card/toast this gesture belongs to
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

  // Put the element back; used on a short drag and on a cancelled/interrupted touch,
  // so a notification can never get stuck offset or faded (the whole point of this).
  function snapBack() {
    el.style.transition = SNAP;
    el.style.transform = '';
    el.style.opacity = '';
    pending = setTimeout(() => {
      clearInline();
      pending = null;
    }, 200);
  }

  function end(x, y) {
    if (!active) return;
    active = false;
    const r = swipeResult(x - x0, y - y0);
    if (!r.dismiss) {
      snapBack();
      return;
    }
    const mine = token;
    el.style.transition = SNAP;
    el.style.transform = exitTransform(r.axis, r.dir);
    el.style.opacity = '0';
    pending = setTimeout(() => {
      clearInline(); // reset before onDismiss, so the next notification shows fresh
      pending = null;
      onDismiss(mine); // mine lets the caller ignore a card/toast that was already replaced
    }, 200);
  }

  function cancel() {
    if (!active) return;
    active = false;
    snapBack();
  }

  el.addEventListener('touchstart', (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  el.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY, e); }, { passive: false });
  el.addEventListener('touchend', (e) => { const t = (e.changedTouches && e.changedTouches[0]) || {}; end(t.clientX == null ? x0 : t.clientX, t.clientY == null ? y0 : t.clientY); });
  el.addEventListener('touchcancel', cancel);
  el.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('mousemove', (e) => { if (active) move(e.clientX, e.clientY, e); });
    window.addEventListener('mouseup', (e) => { if (active) end(e.clientX, e.clientY); });
    window.addEventListener('blur', cancel); // mouse released off-window / app backgrounded mid-drag
  }
}

let toastTimer = null;
let toastSwipeWired = false;
let toastGen = 0;
export function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
}

export function toast(message, ms) {
  const node = $('toast');
  if (!toastSwipeWired) {
    // Flick it away instead of waiting; the token guards against hiding a newer toast (#swipe-dismiss).
    makeSwipeable(node, (tok) => { if (tok == null || tok === toastGen) hideToast(); }, () => toastGen);
    toastSwipeWired = true;
  }
  toastGen += 1;
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
  const options = Object.assign({}, init, controller ? { signal: controller.signal } : {});
  const start = Date.now();
  let headerTimer = null;
  const headerTimeout = new Promise((resolve, reject) => {
    headerTimer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
  });
  // Each body read gets what is left of the budget (at least 2 s) and aborts a
  // stalled download. The header timer is cleared the moment the response
  // arrives, so a caller that returns without reading a body (a 404 tile, say)
  // leaves no timer or AbortController dangling (#4).
  const body = (promise) => {
    const remaining = Math.max(2000, ms - (Date.now() - start));
    let t = null;
    const timeout = new Promise((resolve, reject) => {
      t = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error(`timed out after ${ms} ms`));
      }, remaining);
    });
    return Promise.race([promise, timeout]).then(
      (value) => {
        clearTimeout(t);
        return value;
      },
      (err) => {
        clearTimeout(t);
        throw err;
      },
    );
  };
  return Promise.race([fetch(url, options), headerTimeout]).then(
    (res) => {
      clearTimeout(headerTimer);
      return {
        ok: res.ok,
        status: res.status,
        json: () => body(res.json()),
        text: () => body(res.text()),
        arrayBuffer: () => body(res.arrayBuffer()),
      };
    },
    (err) => {
      clearTimeout(headerTimer);
      throw err;
    },
  );
}
