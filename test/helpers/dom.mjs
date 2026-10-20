// A tiny fake DOM for page modules under node, and 'leaflet' swapped for
// test/helpers/fake-leaflet.mjs. Import this before the module under test.

import { registerHooks } from 'node:module';

const FAKE_LEAFLET = new URL('./fake-leaflet.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'leaflet') return { url: FAKE_LEAFLET, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export function fakeNode(tag) {
  const node = {
    tag,
    children: [],
    attrs: {},
    listeners: {},
    hidden: false,
    className: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(event, fn) {
      this.listeners[event] = fn;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return this.attrs[name];
    },
    get textContent() {
      return this.children.map((c) => (typeof c.text === 'string' ? c.text : c.textContent || '')).join('');
    },
    set textContent(value) {
      this.children = value ? [{ text: String(value) }] : [];
    },
  };
  return node;
}

/** Every node under root (depth first), for finding what a module drew. */
export function allNodes(root) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
  return out;
}

const byId = {};
globalThis.document = {
  getElementById: (id) => (byId[id] = byId[id] || fakeNode('div')),
  createElement: (tag) => fakeNode(tag),
  createTextNode: (text) => ({ text }),
  body: fakeNode('body'),
  documentElement: Object.assign(fakeNode('html'), { style: { setProperty() {} } }),
};
if (!globalThis.window) globalThis.window = {};
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};
