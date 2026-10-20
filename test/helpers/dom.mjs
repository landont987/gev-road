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

/**
 * A map for page modules under node: a view box {south, west, north, east}
 * (the whole world unless given), 'moveend' listeners and the layers added.
 * moveTo(box) moves the view and fires 'moveend', like a pan on the real map.
 */
export function fakeMap(box) {
  let view = box || { south: -90, west: -180, north: 90, east: 180 };
  const listeners = {};
  return {
    layers: [],
    views: [], // every setView center, newest last
    getZoom: () => 13,
    setView(center) {
      this.views.push(center);
      return this;
    },
    /** Fires an event's listeners, like a finger drag or a pan on the real map. */
    fire(event) {
      (listeners[event] || []).forEach((fn) => fn());
    },
    getBounds: () => ({
      getSouth: () => view.south,
      getWest: () => view.west,
      getNorth: () => view.north,
      getEast: () => view.east,
    }),
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return this;
    },
    addLayer(layer) {
      if (this.layers.indexOf(layer) < 0) this.layers.push(layer);
      return this;
    },
    removeLayer(layer) {
      this.layers = this.layers.filter((l) => l !== layer);
      return this;
    },
    hasLayer(layer) {
      return this.layers.indexOf(layer) >= 0;
    },
    moveTo(next) {
      view = next;
      (listeners.moveend || []).forEach((fn) => fn());
    },
  };
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
