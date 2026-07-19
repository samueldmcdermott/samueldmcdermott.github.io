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
      if (p.endsWith("/revgeo")) return await revgeo(lat, lon, env, ctx, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 502, cors);
    }
  },
};

// ---- AirNow (official EPA) ----
const AIRNOW_DISTANCE_MI = 25; // fallback radius only (rural/unmapped ZIPs)

async function airnow(pathname, url, lat, lon, env, cors, ctx) {
  const key = env.AIRNOW_KEY;
  if (!key) return json({ error: "proxy missing AIRNOW_KEY" }, 500, cors);

  if (pathname.endsWith("/airnow/observation")) {
    return airnowObservation(lat, lon, key, cors);
  }
  return airnowForecast(url, lat, lon, key, env, ctx, cors);
}

// CURRENT observations — match what airnow.gov shows for a point.
//
// The reporting-area feed (observation/zipCode|latLong) returns the PEAK AQI
// across ALL monitors in the area. airnow.gov's location page instead shows the
// monitor NEAREST that point, which can be far lower (e.g. Philadelphia ZIP
// 19143: area peak PM2.5 158 vs the nearest monitor's NowCast 96). To agree with
// the site we query the per-monitor `aq/data` feed over a small box and keep the
// NEAREST monitor for each pollutant, then shape it like the old feed so the
// client is unchanged.
async function airnowObservation(lat, lon, key, cors) {
  const d = AIRNOW_DISTANCE_MI / 69; // deg
  const bbox = `${(lon - d).toFixed(4)},${(lat - d).toFixed(4)},${(lon + d).toFixed(4)},${(lat + d).toFixed(4)}`;

  // Query the per-monitor aq/data feed for the current hour; if AirNow hasn't
  // published it yet (updates ~:35 past the hour) fall back to the previous
  // hour, so a fresh page load early in the hour still shows data.
  const nowMs = Date.now();
  for (const backHrs of [0, 1]) {
    const hour = new Date(nowMs - backHrs * 3600e3).toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const u = `${AIRNOW}/data/?startDate=${hour}&endDate=${hour}`
      + `&parameters=OZONE,PM25,PM10,NO2&BBOX=${bbox}&dataType=A&format=application/json`
      + `&verbose=1&nowcastonly=1&API_KEY=${key}`;
    const r = await fetch(u, { cf: { cacheTtl: 600 } });
    const rows = safeArray(await r.text());
    if (!r.ok || !rows) continue;

    // Keep the nearest monitor per pollutant.
    const nearest = {}; // Parameter -> { row, dist }
    for (const x of rows) {
      if (!isNum(x.AQI) || x.AQI < 0) continue;
      if (!isNum(x.Latitude) || !isNum(x.Longitude)) continue;
      const dist = haversineMi(lat, lon, x.Latitude, x.Longitude);
      const cur = nearest[x.Parameter];
      if (!cur || dist < cur.dist) nearest[x.Parameter] = { row: x, dist };
    }
    if (!Object.keys(nearest).length) continue; // no usable monitors this hour

    // Shape like the legacy observation feed the client already renders.
    const obs = Object.values(nearest).map(({ row, dist }) => ({
      DateObserved: (row.UTC || "").slice(0, 10),
      HourObserved: null,             // aq/data is UTC; the client shows a date instead
      UTC: row.UTC,
      ReportingArea: row.SiteName,    // now the actual nearest site, not the area
      StateCode: "",
      Latitude: row.Latitude, Longitude: row.Longitude,
      DistanceMi: Math.round(dist * 10) / 10,
      ParameterName: PARAM_LABEL[row.Parameter] || row.Parameter,
      AQI: row.AQI,
      Category: { Number: row.Category, Name: aqiCategoryName(row.AQI) },
    }));
    obs.sort((a, b) => b.AQI - a.AQI); // headline (client picks max) first
    return json(obs, 200, cors);
  }

  // No nearby monitors (sparse/rural) — fall back to the reporting-area feed so
  // the box still shows a regional value rather than going blank.
  const llurl = `${AIRNOW}/observation/latLong/current/?format=application/json`
    + `&latitude=${lat}&longitude=${lon}&distance=${AIRNOW_DISTANCE_MI}&API_KEY=${key}`;
  const fr = await fetch(llurl, { cf: { cacheTtl: 600 } });
  const body = await fr.text();
  return new Response(body, { status: fr.ok ? 200 : 502, headers: { ...cors, "Content-Type": "application/json" } });
}

// AirNow's aq/data uses short parameter codes; map to the display names the
// client (and the old feed) used.
const PARAM_LABEL = { PM25: "PM2.5", PM10: "PM10", OZONE: "O3", NO2: "NO2", CO: "CO", SO2: "SO2" };

// DAILY forecast — unchanged: reverse-geocode to ZIP and use the ZIP forecast
// (matches airnow.gov's forecast), falling back to lat/lon.
async function airnowForecast(url, lat, lon, key, env, ctx, cors) {
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const zip = await latLonToZip(lat, lon, env, ctx).catch(() => null);
  if (zip) {
    const zurl = `${AIRNOW}/forecast/zipCode/?format=application/json`
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
  const llurl = `${AIRNOW}/forecast/latLong/?format=application/json`
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

// Reverse-geocode a coordinate to its US city + state, for labelling exactly
// where a monitor physically sits (AirNow's own site names aren't user-useful).
// Returns { city, state } — either may be "" if the point has none (ocean,
// non-US, unincorporated with no CDP). Cached in KV under a "p:" prefix (place
// boundaries are effectively static, like ZCTAs). Same durability/error rules
// as latLonToZip: real answers (including "nothing here") are cached; a call
// failure is not, so a transient Census outage can't poison the cache.
const PLACE_NONE = "-"; // sentinel for "we looked, no US place here"

async function revgeo(lat, lon, env, ctx, cors) {
  const kv = env && env.ZIP_CACHE; // reuse the same namespace, distinct key prefix
  const key = `p:${lat.toFixed(3)},${lon.toFixed(3)}`;

  if (kv) {
    const cached = await kv.get(key).catch(() => null);
    if (cached === PLACE_NONE) return json({ city: "", state: "" }, 200, cors);
    if (cached) {
      const [city, state] = cached.split("|");
      return json({ city: city || "", state: state || "" }, 200, cors);
    }
  }

  const place = await censusPlace(lat, lon); // { city, state } | null | undefined
  if (kv && place !== undefined) {
    const val = place ? `${place.city}|${place.state}` : PLACE_NONE;
    const put = kv.put(key, val).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return json(place || { city: "", state: "" }, 200, cors);
}

// Raw Census lookup for a place name. Returns { city, state }, null (no US place
// here — a real, cacheable answer), or undefined (call failed — do NOT cache).
// Prefers an Incorporated Place; falls back to a Census Designated Place for
// unincorporated areas. State comes from the States layer's postal abbreviation.
async function censusPlace(lat, lon) {
  const q = new URLSearchParams({
    x: String(lon), y: String(lat),
    benchmark: "Public_AR_Current", vintage: "Current_Current",
    layers: "Incorporated Places,Census Designated Places,States", format: "json",
  });
  let r;
  try { r = await fetch(`${CENSUS}?${q}`); } catch { return undefined; }
  if (!r.ok) return undefined;
  const d = await r.json().catch(() => null);
  if (!d) return undefined;
  const g = d?.result?.geographies || {};
  const place = (g["Incorporated Places"] || [])[0] || (g["Census Designated Places"] || [])[0];
  const st = (g["States"] || [])[0];
  const city = (place && (place.BASENAME || place.NAME)) || "";
  const state = (st && (st.STUSAB || st.BASENAME)) || "";
  if (!city && !state) return null; // nothing usable here
  return { city, state };
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

// US AQI category name from an AQI value (matches the client's AQI_CATS names).
function aqiCategoryName(aqi) {
  if (!isNum(aqi)) return "";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
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
