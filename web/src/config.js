// Every external address the app talks to lives here. All were checked live
// on 2026-10-06 (see README "Data sources").

/* global __KEYS__ */
export const KEYS = typeof __KEYS__ === 'object' && __KEYS__ ? __KEYS__ : {};

// OpenStreetMap's standard tiles: no key, light personal use allowed by the
// OSMF tile policy (the Android app sends its own User-Agent). CARTO's dark
// tiles now answer "API KEY REQUIRED", so they are not used. The app darkens
// these tiles with a CSS filter for night driving.
export const BASEMAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BASEMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const BASEMAP_MAX_ZOOM = 19;

// ADOT camera list republished by the state's AZ911 GIS office. No key.
export const AZ_CAMERAS_URL =
  'https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/ADOT_cameras/FeatureServer/0/query' +
  '?where=1%3D1&outFields=Id,Roadway,Direction,Location,Views&outSR=4326&f=json';

// Hourly OpenStreetMap extract of license plate reader cameras (DeFlock).
export const ALPR_TILE_URL = 'https://tiles.dontgetflocked.com/cameras-us-hourly/{z}/{x}/{y}.mvt';
export const ALPR_MIN_TILE_ZOOM = 9;
export const ALPR_MAX_TILE_ZOOM = 12;
export const ALPR_MAX_TILES = 16;

export const ROUTE_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
export const SEARCH_URL = 'https://photon.komoot.io/api/';

// TomTom raster flow tiles. Unverified until a key exists: TomTom checks the
// key before the path, so the style name cannot be probed without one.
export const TRAFFIC_URL = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative0-dark/{z}/{x}/{y}.png';
export const TRAFFIC_REFRESH_MS = 5 * 60 * 1000;

export const CAMERA_LIST_TTL_MS = 24 * 60 * 60 * 1000;
export const ALPR_TILE_TTL_MS = 60 * 60 * 1000;

// Below this speed the truck counts as stopped and camera pictures may load.
export const MOVING_SPEED_MPS = 2.2; // about 5 mph
export const OFF_ROUTE_M = 150;
export const OFF_ROUTE_FIXES = 3;
export const REROUTE_MIN_GAP_MS = 30 * 1000;
export const DATA_WARN_BYTES = 100 * 1024 * 1024;

export const START_VIEW = { lat: 33.4484, lon: -112.074, zoom: 13 }; // downtown Phoenix
export const DRIVE_ZOOM = 16;
// Low data mode stops zooming past this, so fewer ~30 KB map tiles load per mile.
export const LOW_DATA_MAX_ZOOM = 15;
