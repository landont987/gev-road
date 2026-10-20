// A stand-in for Leaflet under node: records markers and their tap handlers.
// Loaded in place of 'leaflet' by test/helpers/dom.mjs.

export const markers = [];

function layer() {
  return {
    layers: [],
    addTo(map) {
      if (map && map.addLayer) map.addLayer(this);
      return this;
    },
    addLayer(l) {
      this.layers.push(l);
      return this;
    },
    removeLayer(l) {
      this.layers = this.layers.filter((x) => x !== l);
      return this;
    },
    clearLayers() {
      this.layers = [];
      return this;
    },
  };
}

const L = {
  layerGroup: () => layer(),
  divIcon: (opts) => ({ opts }),
  marker(latlng, opts) {
    const m = {
      latlng,
      opts,
      handlers: {},
      on(event, fn) {
        this.handlers[event] = fn;
        return this;
      },
      addTo(group) {
        if (group && group.addLayer) group.addLayer(this);
        markers.push(this);
        return this;
      },
      setLatLng(next) {
        this.latlng = next;
        return this;
      },
      getElement: () => null,
      tap() {
        this.handlers.click();
      },
    };
    return m;
  },
};

export default L;
