// Lowers the page's radio players while a spoken alert plays, then restores them.
// Players register with trackPlayer; a stopped player (src removed) drops out.

const DUCK_VOLUME = 0.25;
const players = new Set();
const saved = new Map(); // player -> volume before ducking
let ducked = false;

function lower(player) {
  if (!saved.has(player)) saved.set(player, player.volume);
  player.volume = Math.min(player.volume, DUCK_VOLUME);
}

export function trackPlayer(player) {
  players.add(player);
  // "emptied" also fires when a new src is set; only a removed src means stopped.
  player.addEventListener('emptied', () => {
    if (player.getAttribute('src')) return;
    players.delete(player);
    saved.delete(player);
  });
  if (ducked) lower(player);
}

export function duck(on) {
  if (on === ducked) return;
  ducked = on;
  if (on) {
    players.forEach(lower);
    return;
  }
  saved.forEach((volume, player) => {
    player.volume = volume;
  });
  saved.clear();
}
