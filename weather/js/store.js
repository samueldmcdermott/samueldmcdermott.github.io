// localStorage cache of measured observations. NWS only serves ~7 days of
// station observations, so to fill the full 10-day past window we snapshot what
// we see, keyed by location, and let the record grow the longer the page is
// used. This is the ONLY thing we persist — the chosen location lives in the
// URL (see main.js); fields/units are session-only in-memory defaults.

const OBS_PREFIX = "wx.obs.v1."; // + locKey

function safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota / privacy mode */ }
}

// ---- observed-value cache ----
// A location key rounded to ~1km so tiny lat/lon jitter maps to one bucket.
export function locKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// Merge freshly-fetched observations (array of {t: ISO hour, ...fields}) into
// the cache for a location. Newer values win on collision. Prunes anything
// older than 12 days so the store can't grow without bound.
export function mergeObservations(lat, lon, obs) {
  const key = OBS_PREFIX + locKey(lat, lon);
  const existing = safeGet(key) || {};
  for (const o of obs) {
    if (o && o.t) existing[o.t] = { ...existing[o.t], ...o };
  }
  const cutoff = Date.now() - 12 * 864e5;
  for (const t of Object.keys(existing)) {
    if (new Date(t).getTime() < cutoff) delete existing[t];
  }
  safeSet(key, existing);
  return Object.values(existing).sort((a, b) => a.t.localeCompare(b.t));
}

export function loadObservations(lat, lon) {
  const key = OBS_PREFIX + locKey(lat, lon);
  const existing = safeGet(key) || {};
  return Object.values(existing).sort((a, b) => a.t.localeCompare(b.t));
}
