// Cloudflare Worker: air-quality proxy.
//
// Holds provider API keys server-side (as secrets, never in client code) and
// re-serves data with permissive CORS so the static site can read it. Three
// providers, each optional (a route only works if its secret is set):
//
//   AirNow (EPA, official, regulatory) — the headline. Key: AIRNOW_KEY.
//     GET /airnow/observation?lat=&lon=            -> current obs JSON (array)
//     GET /airnow/forecast?lat=&lon=[&date=Y-M-D]  -> daily forecast (array)
//
//   PurpleAir (low-cost sensor network) — secondary cross-check. Key: PURPLEAIR_KEY.
//     GET /purpleair?lat=&lon=[&radius=]   -> { pm25, aqi, sensors, ... } (EPA-corrected)
//
//   AirGradient (open sensor network) — secondary cross-check. Key: AIRGRADIENT_TOKEN.
//     GET /airgradient?lat=&lon=[&radius=] -> { pm25, aqi, sensors, ... }
//
// The two sensor networks return raw sensors near a point; the proxy averages
// them spatially (NaN-safe, staleness- and quality-filtered) and converts to US
// AQI, so the client just displays a number. See ../AIR_QUALITY_SETUP.md to deploy.

const AIRNOW = "https://www.airnowapi.org/aq";
const PURPLEAIR = "https://api.purpleair.com/v1/sensors";
const AIRGRADIENT = "https://api.airgradient.com/public/api/v1/world/locations/measures/current";
// Keyless US Census reverse geocoder: lat/lon -> ZIP (ZCTA). Not CORS-clean for
// the browser, which is one reason the lat/lon -> ZIP step lives here.
const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";

// Lock this to your site's origin (or "*" while testing).
const ALLOW_ORIGIN = "https://samueldmcdermott.github.io";

// Default search radius (miles) for the sensor networks. Small enough to be
// "local", large enough to usually catch a few sensors in a populated area.
const DEFAULT_RADIUS_MI = 5;
const MAX_RADIUS_MI = 25;
// Sensors reporting older than this are dropped as stale.
const MAX_STALE_MIN = 60;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=600", // sources update ~hourly / ~10 min
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const lat = num(url.searchParams.get("lat"));
    const lon = num(url.searchParams.get("lon"));
    if (lat == null || lon == null) return json({ error: "lat/lon required" }, 400, cors);

    const p = url.pathname;
    try {
      if (p.endsWith("/airnow/observation") || p.endsWith("/airnow/forecast")) {
        return await airnow(p, url, lat, lon, env, cors, ctx);
      }
      if (p.endsWith("/purpleair")) return await purpleair(url, lat, lon, env, cors);
      if (p.endsWith("/airgradient")) return await airgradient(url, lat, lon, env, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  },
};

// ---- AirNow (official EPA) ----
// AirNow reports at REPORTING-AREA granularity (peak AQI across the area's
// monitors). airnow.gov's front end resolves a ZIP -> reporting area via a table
// agencies maintain; the lat/lon endpoint has no such table and instead does a
// geometric "nearest monitor within `distance`" search, which can grab a
// neighboring area. So we mirror the front end: reverse-geocode lat/lon -> ZIP
// (via the keyless Census geocoder) and query AirNow BY ZIP, which uses that
// same mapping. Only if the ZIP is unknown/unmapped do we fall back to the
// lat/lon endpoint with a tight radius.
const AIRNOW_DISTANCE_MI = 25; // fallback radius only (rural/unmapped ZIPs)

async function airnow(pathname, url, lat, lon, env, cors, ctx) {
  const key = env.AIRNOW_KEY;
  if (!key) return json({ error: "proxy missing AIRNOW_KEY" }, 500, cors);

  const isObs = pathname.endsWith("/airnow/observation");
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const zip = await latLonToZip(lat, lon, env, ctx).catch(() => null);

  // Try the ZIP endpoint first (matches airnow.gov). If it errors or returns no
  // data (unmapped ZIP), fall back to the lat/lon endpoint.
  if (zip) {
    const zurl = isObs
      ? `${AIRNOW}/observation/zipCode/current/?format=application/json`
        + `&zipCode=${zip}&distance=${AIRNOW_DISTANCE_MI}&API_KEY=${key}`
      : `${AIRNOW}/forecast/zipCode/?format=application/json`
        + `&zipCode=${zip}&date=${date}&distance=${AIRNOW_DISTANCE_MI}&API_KEY=${key}`;
    const zr = await fetch(zurl, { cf: { cacheTtl: 600 } });
    if (zr.ok) {
      const body = await zr.text();
      const arr = safeArray(body);
      if (arr && arr.length) {
        return new Response(body, { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }
  }

  // Fallback: lat/lon with a tight radius.
  const llurl = isObs
    ? `${AIRNOW}/observation/latLong/current/?format=application/json`
      + `&latitude=${lat}&longitude=${lon}&distance=${AIRNOW_DISTANCE_MI}&API_KEY=${key}`
    : `${AIRNOW}/forecast/latLong/?format=application/json`
      + `&latitude=${lat}&longitude=${lon}&date=${date}&distance=${AIRNOW_DISTANCE_MI}&API_KEY=${key}`;
  const r = await fetch(llurl, { cf: { cacheTtl: 600 } });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Reverse-geocode a coordinate to its US ZIP (ZCTA). Returns a 5-digit string
// or null (non-US, ocean, service down). Backed by a durable Workers KV cache
// (env.ZIP_CACHE) keyed by ~3-decimal coords (~110 m grid — same ZIP anyway),
// since ZCTA boundaries only change with the decennial census. A miss falls
// through to the keyless Census geocoder and the result is written back. If no
// KV namespace is bound, it degrades to a plain Census call every time.
const ZIP_NONE = "-"; // sentinel: "we looked, there is no US ZIP here" (cache negatives too)

async function latLonToZip(lat, lon, env, ctx) {
  const kv = env && env.ZIP_CACHE;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;

  if (kv) {
    const cached = await kv.get(key).catch(() => null);
    if (cached === ZIP_NONE) return null;
    if (cached) return cached;
  }

  const zip = await censusZip(lat, lon);
  // Cache real answers only. A ZIP and a "no US ZIP here" (null) are both real,
  // durable answers; a call failure (undefined) is NOT cached, so a transient
  // Census outage can't poison the cache with a false negative. The write must
  // be handed to ctx.waitUntil() — otherwise the isolate can be torn down when
  // the response returns and the KV commit is abandoned (a bare `await put` is
  // not enough). Fall back to awaiting it if no ctx was passed.
  if (kv && zip !== undefined) {
    const put = kv.put(key, zip === null ? ZIP_NONE : zip).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return zip === undefined ? null : zip;
}

// Raw Census lookup. Returns a 5-digit ZIP, null (point has no US ZIP — a real,
// cacheable answer), or undefined (call failed — do NOT cache).
async function censusZip(lat, lon) {
  const q = new URLSearchParams({
    x: String(lon), y: String(lat),
    benchmark: "Public_AR_Current", vintage: "Current_Current",
    layers: "2020 Census ZIP Code Tabulation Areas", format: "json",
  });
  let r;
  try { r = await fetch(`${CENSUS}?${q}`); } catch { return undefined; }
  if (!r.ok) return undefined;
  const d = await r.json().catch(() => null);
  if (!d) return undefined;
  const areas = d?.result?.geographies?.["2020 Census ZIP Code Tabulation Areas"];
  const zip = areas && areas[0] && (areas[0].ZCTA5 || areas[0].GEOID || areas[0].BASENAME);
  return /^\d{5}$/.test(zip || "") ? zip : null;
}

function safeArray(text) {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : null; }
  catch { return null; }
}

// ---- PurpleAir (low-cost sensors, EPA-corrected) ----
// Query a bounding box around the point, then average the PM2.5 of nearby,
// fresh, confident sensors after applying the EPA US correction, and convert to
// US AQI. Returns { pm25, aqi, sensors, radiusMi }.
async function purpleair(url, lat, lon, env, cors) {
  const key = env.PURPLEAIR_KEY;
  if (!key) return json({ error: "proxy missing PURPLEAIR_KEY" }, 500, cors);

  const radius = clampRadius(num(url.searchParams.get("radius")));
  const box = bbox(lat, lon, radius);
  // Outdoor sensors (location_type=0) only; ask for cf_1 (used by the EPA eqn),
  // humidity, position, confidence and freshness.
  const fields = "latitude,longitude,pm2.5_cf_1,humidity,confidence,last_seen";
  const q = new URLSearchParams({
    fields,
    location_type: "0",
    nwlng: String(box.w), nwlat: String(box.n),
    selng: String(box.e), selat: String(box.s),
  });
  const r = await fetch(`${PURPLEAIR}?${q}`, {
    headers: { "X-API-Key": key },
    cf: { cacheTtl: 600 },
  });
  if (!r.ok) return json({ error: `purpleair ${r.status}` }, 502, cors);
  const data = await r.json();
  const idx = colIndex(data.fields);
  const nowSec = Date.now() / 1000;

  const values = [];
  for (const row of data.data || []) {
    const slat = row[idx["latitude"]], slon = row[idx["longitude"]];
    const cf1 = row[idx["pm2.5_cf_1"]], rh = row[idx["humidity"]];
    const conf = row[idx["confidence"]], seen = row[idx["last_seen"]];
    if (!isNum(slat) || !isNum(slon) || !isNum(cf1)) continue;          // NaN-safe
    if (isNum(conf) && conf < 70) continue;                             // low channel agreement -> drop
    if (isNum(seen) && (nowSec - seen) > MAX_STALE_MIN * 60) continue;  // stale -> drop
    if (haversineMi(lat, lon, slat, slon) > radius) continue;           // box corners -> circle
    values.push(epaCorrectedPm(cf1, rh));
  }
  return json(summarize(values, radius), 200, cors);
}

// ---- AirGradient (open sensor network) ----
// The world feed is PUBLIC — no token required — so this route needs no setup.
// It also has no spatial filter, so we fetch all world public locations and
// filter to the radius here, then average PM2.5 and convert to US AQI. A token
// is sent only if one happens to be configured (harmless, not needed).
async function airgradient(url, lat, lon, env, cors) {
  const token = env.AIRGRADIENT_TOKEN; // optional
  const radius = clampRadius(num(url.searchParams.get("radius")));
  const feed = token ? `${AIRGRADIENT}?token=${encodeURIComponent(token)}` : AIRGRADIENT;
  const r = await fetch(feed, { cf: { cacheTtl: 600 } });
  if (!r.ok) return json({ error: `airgradient ${r.status}` }, 502, cors);
  const list = await r.json();

  // The endpoint may return a bare array or wrap rows under a key; handle both.
  const rows = Array.isArray(list) ? list : (list && list.measures) || [];
  const values = [];
  for (const loc of rows) {
    const slat = num(loc.latitude), slon = num(loc.longitude);
    // Prefer AirGradient's EPA-corrected PM2.5; fall back to raw pm02.
    const pm = num(loc.pm02_corrected) ?? num(loc.pm02);
    if (slat == null || slon == null || pm == null) continue;          // NaN-safe
    if (haversineMi(lat, lon, slat, slon) > radius) continue;
    values.push(pm);
  }
  return json(summarize(values, radius), 200, cors);
}

// ---- shared math ----

// Average a list of PM2.5 values and package with count + derived AQI.
function summarize(values, radiusMi) {
  const clean = values.filter(isNum);
  if (!clean.length) return { pm25: null, aqi: null, sensors: 0, radiusMi };
  const pm25 = clean.reduce((a, b) => a + b, 0) / clean.length;
  return {
    pm25: round1(pm25),
    aqi: pmToAqi(pm25),
    sensors: clean.length,
    radiusMi,
  };
}

// EPA US-wide correction (Barkjohn 2021) for PurpleAir cf_1:
//   PM2.5 = 0.524 * cf_1 - 0.0862 * RH + 5.75   (clamped at 0)
// If humidity is missing, use the equation's assumption of ~35% RH so a single
// missing field doesn't drop an otherwise-good sensor.
function epaCorrectedPm(cf1, rh) {
  const humidity = isNum(rh) ? rh : 35;
  return Math.max(0, 0.524 * cf1 - 0.0862 * humidity + 5.75);
}

// US EPA AQI from 24h PM2.5 (µg/m³), piecewise-linear over the standard
// breakpoints. This is an instantaneous approximation (not a NowCast).
const PM_BP = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 350.4, 301, 400],
  [350.5, 500.4, 401, 500],
];
function pmToAqi(pm) {
  if (!isNum(pm)) return null;
  const c = Math.max(0, Math.min(pm, 500.4));
  for (const [cLo, cHi, aLo, aHi] of PM_BP) {
    if (c >= cLo && c <= cHi) {
      return Math.round(((aHi - aLo) / (cHi - cLo)) * (c - cLo) + aLo);
    }
  }
  return 500;
}

// Bounding box (deg) for a radius (mi) around a point. Longitude degrees shrink
// with latitude; latitude degrees are ~69 mi everywhere.
function bbox(lat, lon, radiusMi) {
  const dLat = radiusMi / 69;
  const dLon = radiusMi / (69 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  return { n: lat + dLat, s: lat - dLat, e: lon + dLon, w: lon - dLon };
}

// Great-circle distance in miles.
function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// PurpleAir returns parallel arrays: data[] rows indexed by the fields[] order.
function colIndex(fields) {
  const m = {};
  (fields || []).forEach((f, i) => { m[f] = i; });
  return m;
}

function clampRadius(r) {
  if (!isNum(r) || r <= 0) return DEFAULT_RADIUS_MI;
  return Math.min(r, MAX_RADIUS_MI);
}

function isNum(x) { return typeof x === "number" && Number.isFinite(x); }
function round1(x) { return Math.round(x * 10) / 10; }
function num(s) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
