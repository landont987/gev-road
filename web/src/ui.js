// Small DOM helpers. Text always goes in through textContent, never innerHTML,
// because camera names and search results come from outside sources.

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

let toastTimer = null;
export function toast(message, ms) {
  const node = $('toast');
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
