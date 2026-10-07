// Every external address the app talks to lives here. All were checked live
// on 2026-10-06 (see README "Data sources").

/* global __KEYS__ */
export const KEYS = typeof __KEYS__ === 'object' && __KEYS__ ? __KEYS__ : {};

// OpenStreetMap's standard tiles: no key, light personal use allowed by the
// OSMF tile policy (the Android app sends its own User-Agent). CARTO's dark
// tiles now answer "API KEY REQUIRED", so they are not used. The tiles are
// shown as they come: a CSS darkening filter costs too much on the head unit.
export const BASEMAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BASEMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const BASEMAP_MAX_ZOOM = 19;

// ADOT camera list republished by the state's AZ911 GIS office. No key.
export const AZ_CAMERAS_URL =
  'https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/ADOT_cameras/FeatureServer/0/query' +
  '?where=1%3D1&outFields=Id,Roadway,Direction,Location,Views&outSR=4326&f=json';

// ADOT's own list, fresh, with your free AZ511 developer key in keys.local.json
// (sign up at az511.com; 10 calls a minute). Used instead of the copy above
// when the key is set, because the copy was last edited 2026-03-16.
export const AZ511_API_CAMERAS_URL = 'https://az511.com/api/v2/get/cameras?format=json&key=';
export const AZ511_IMAGE_URL = 'https://az511.com/map/Cctv/';

// Hourly OpenStreetMap extract of license plate reader cameras (DeFlock).
export const ALPR_TILE_URL = 'https://tiles.dontgetflocked.com/cameras-us-hourly/{z}/{x}/{y}.mvt';
export const ALPR_MIN_TILE_ZOOM = 9;
export const ALPR_MAX_TILE_ZOOM = 12;
export const ALPR_MAX_TILES = 16;

export const ROUTE_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';
export const SEARCH_URL = 'https://photon.komoot.io/api/';

// TomTom raster flow tiles, style relative0: the colors TomTom documents for a
// light map (relative0-dark is its dimmed set for dark maps). Path and style
// names match TomTom's raster flow tile docs (checked 2026-10-07); a real tile
// is unproven until a key exists, because TomTom answers 401 before the path.
export const TRAFFIC_URL = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png';
export const TRAFFIC_REFRESH_MS = 5 * 60 * 1000;

// Broadcastify Calls Client API (bcfy.io/dev): recorded radio calls, metered,
// prepaid, scanner-style listening apps allowed for one metro. Needs the app's
// key id, secret and app id in keys.local.json plus your Broadcastify login,
// typed into the app. Endpoints and token format copied from working open
// source clients (ifnull/radio-feed-watch, arjohnsonn/austin-incident-map).
export const BCFY_AUTH_URL = 'https://api.bcfy.io/common/v1/auth';
export const BCFY_LIVE_URL = 'https://api.bcfy.io/calls/v1/live/';
export const BCFY_POLL_MS = 6000;
export const BCFY_TOKEN_TTL_S = 3600;

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

// Spoken alerts: OpenAI text to speech with your key in keys.local.json ("openai").
// Clips are cached (they play offline); a new alert without a key or internet
// uses the unit's own voice.
export const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';

// AI truck check: Claude looks at a camera picture for your truck while you are
// stopped near it. Key in keys.local.json ("anthropic"). About 1 to 2 cents a check.
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const TRUCK_CHECK_MODEL = 'claude-opus-5-5';

// Speed and red-light cameras mapped in OpenStreetMap, all of Arizona in one
// small answer (about 6 KB, 27 cameras on 2026-10-07), fetched once a day.
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const SPEED_CAMERAS_QUERY = '[out:json][timeout:30];node["highway"="speed_camera"](31.3,-114.9,37.1,-109.0);out body;';
export const SPEED_CAMERAS_TTL_MS = 24 * 60 * 60 * 1000;
