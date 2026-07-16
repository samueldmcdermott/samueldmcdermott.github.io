// Air quality — OFFICIAL EPA AirNow only.
//
// AirNow's API (airnowapi.org) IS reachable from the browser: it sends
// `Access-Control-Allow-Origin: *`. The only barrier is the API key, which must
// not be shipped in public client JS. So we call it through a tiny serverless
// proxy that holds the key and re-serves the data. Set AIRNOW_PROXY to your
// deployed Worker (see AIRNOW_SETUP.md). Until then, the Air box explains setup.
//
// The free AirNow feed is CURRENT observations + a DAILY forecast (with a
// written discussion). It is not an hourly ±10-day series — accuracy over
// granularity — so there is no AQI line on the chart; only the boxes.

export const AIRNOW_PROXY = "https://wx-air.samueldmcdermott.workers.dev"; // e.g. "https://wx-air.<you>.workers.dev"
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
  if (!r.ok) throw new Error(`AirNow proxy ${r.status}`);
  return r.json();
}

// Returns official AirNow data, or { configured:false } when no proxy is set.
// observations: array of { ParameterName, AQI, Category:{Name}, DateObserved,
//   HourObserved, ReportingArea, StateCode, ... }
// forecasts: array of { DateForecast, ParameterName, AQI, Category:{Name},
//   Discussion, ActionDay, ReportingArea, ... }
export async function airQuality(lat, lon) {
  const link = airnowLink(lat, lon);
  if (!airnowConfigured()) return { configured: false, link };
  const [observations, forecasts] = await Promise.all([
    px("/airnow/observation", { lat, lon }).catch(() => []),
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
