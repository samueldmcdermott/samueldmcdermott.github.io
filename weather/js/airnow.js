// Air quality — official EPA AirNow (headline) + two low-cost sensor networks
// (PurpleAir, AirGradient) as secondary cross-checks.
//
// All three go through the same tiny serverless proxy (see AIR_QUALITY_SETUP.md),
// which holds each provider's key server-side. AirNow is the regulatory number;
// the sensor networks are spatially averaged over a small radius by the proxy
// (NaN-safe, staleness/quality filtered) and offered only as corroboration.
//
// AirNow's free feed is CURRENT observations + a DAILY forecast (with a written
// discussion) at REPORTING-AREA granularity — not an hourly ±10-day point
// series — so there is no AQI line on the chart; only the boxes.

export const AIRNOW_PROXY = "https://wx-air.samueldmcdermott.workers.dev";
export function airnowConfigured() { return !!AIRNOW_PROXY; }

// US AQI category boundaries -> name + official AirNow color.
const AQI_CATS = [
  { max: 50,  name: "Good", color: "#00e400" },
  { max: 100, name: "Moderate", color: "#ffff00" },
  { max: 150, name: "Unhealthy for Sensitive Groups", color: "#ff7e00" },
  { max: 200, name: "Unhealthy", color: "#ff0000" },
  { max: 300, name: "Very Unhealthy", color: "#8f3f97" },
  { max: Infinity, name: "Hazardous", color: "#7e0023" },
];
export function aqiCategory(aqi) {
  if (aqi == null) return { name: "—", color: "#999" };
  return AQI_CATS.find((c) => aqi <= c.max);
}

// Deep link to the official AirNow.gov page for this location.
export function airnowLink(lat, lon) {
  return `https://www.airnow.gov/?city=&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
}

async function px(path, params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${AIRNOW_PROXY}${path}?${q}`);
  const data = await r.json().catch(() => null);
  // Surface the proxy's own error message (e.g. missing key) instead of hiding it.
  if (!r.ok || (data && data.error)) {
    throw new Error(data?.error ? `proxy: ${data.error}` : `proxy ${r.status}`);
  }
  return data;
}

// Returns official AirNow data, or { configured:false } when no proxy is set.
// observations: array of { ParameterName, AQI, Category:{Name}, DateObserved,
//   HourObserved, ReportingArea, StateCode, ... }
// forecasts: array of { DateForecast, ParameterName, AQI, Category:{Name},
//   Discussion, ActionDay, ReportingArea, ... }
export async function airQuality(lat, lon) {
  const link = airnowLink(lat, lon);
  if (!airnowConfigured()) return { configured: false, link };
  // Observations are the primary signal — if the proxy errors (e.g. missing
  // key), let it throw so the box can explain it. Forecast is best-effort.
  const [observations, forecasts] = await Promise.all([
    px("/airnow/observation", { lat, lon }),
    px("/airnow/forecast", { lat, lon }).catch(() => []),
  ]);
  // The current AQI is the max sub-index across reported pollutants — pick the
  // observation with the highest AQI as the headline.
  let now = null;
  for (const o of observations || []) {
    if (o.AQI != null && (!now || o.AQI > now.AQI)) now = o;
  }
  return { configured: true, observations: observations || [], forecasts: forecasts || [], now, link };
}

// The reporting area an observation belongs to (for the "why it may differ from
// a point reading" label). AirNow gives ReportingArea + StateCode per obs.
export function reportingAreaLabel(obs) {
  if (!obs) return "";
  const area = (obs.ReportingArea || "").trim();
  const state = (obs.StateCode || "").trim();
  if (!area) return "";
  return state ? `${area}, ${state}` : area;
}

// ---- Secondary sensor networks (best-effort, never throw to the caller) ----
// Each returns { pm25, aqi, sensors, radiusMi } on success, or an { error }
// object the caller can quietly ignore/label. The proxy does the spatial
// averaging + AQI conversion; here we just fetch and normalize failures.

async function sensorNetwork(path, lat, lon, radius) {
  try {
    const params = { lat, lon };
    if (radius) params.radius = radius;
    const d = await px(path, params);
    return { ok: true, ...d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// PurpleAir: EPA-corrected PM2.5 averaged over nearby fresh/confident sensors.
export function purpleAir(lat, lon, radius) {
  return sensorNetwork("/purpleair", lat, lon, radius);
}

// AirGradient: PM2.5 averaged over nearby public outdoor monitors.
export function airGradient(lat, lon, radius) {
  return sensorNetwork("/airgradient", lat, lon, radius);
}
