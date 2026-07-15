// Air quality.
//
// Two sources, in order of preference:
//   1. Open-Meteo Air Quality API — key-free, CORS-clean, works directly from a
//      static site. Gives US AQI + component pollutants (PM2.5, PM10, O3, NO2,
//      SO2, CO) as an hourly forecast. This is the DEFAULT and needs no setup.
//   2. AirNow.gov (official EPA) — more authoritative and includes a written
//      forecast discussion, BUT requires a secret API key and sends no CORS
//      headers, so it can only be reached through a proxy you deploy. If you set
//      AIRNOW_PROXY below, the box upgrades to AirNow automatically. The proxy
//      just needs to expose GET /airnow/observation?lat=&lon= and
//      /airnow/forecast?lat=&lon= that inject the key and add CORS.

export const AIRNOW_PROXY = ""; // optional; set to your proxy base to use AirNow.
export function airnowConfigured() { return !!AIRNOW_PROXY; }

// US AQI category boundaries -> name + official color (used for the pill).
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

// ---- Open-Meteo air quality (default source) ----
async function openMeteoAir(lat, lon) {
  // us_aqi = overall index; us_aqi_* = per-pollutant SUB-INDICES (same 0–500
  // scale as the overall AQI, which is their max). The raw pm2_5/pm10/ozone/no2
  // are concentrations in µg/m³ — a different, non-invertible scale.
  const hourly = [
    "us_aqi", "us_aqi_pm2_5", "us_aqi_pm10", "us_aqi_ozone", "us_aqi_nitrogen_dioxide",
    "pm2_5", "pm10", "ozone", "nitrogen_dioxide",
  ].join(",");
  const url =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${hourly}&past_days=10&forecast_days=5&timezone=UTC`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo air ${r.status}`);
  const d = await r.json();
  const h = d.hourly;
  if (!h?.time?.length) return { source: "Open-Meteo", now: null, peak: null, series: [], link: airnowLink(lat, lon) };

  // hourly series aligned to the same UTC-hour keys the chart uses.
  const series = h.time.map((t, i) => ({
    t: new Date(t + "Z").toISOString().slice(0, 13) + ":00:00Z",
    aqi: h.us_aqi[i],
    // sub-indices (0–500, same units as aqi)
    aqiPm25: h.us_aqi_pm2_5[i], aqiPm10: h.us_aqi_pm10[i],
    aqiOzone: h.us_aqi_ozone[i], aqiNo2: h.us_aqi_nitrogen_dioxide[i],
    // concentrations (µg/m³)
    pm25: h.pm2_5[i], pm10: h.pm10[i], ozone: h.ozone[i], no2: h.nitrogen_dioxide[i],
  }));

  // nearest hour to "now" for the summary
  const nowMs = Date.now();
  let ni = 0, best = Infinity;
  h.time.forEach((t, i) => {
    const dt = Math.abs(new Date(t + "Z").getTime() - nowMs);
    if (dt < best) { best = dt; ni = i; }
  });
  const now = {
    aqi: h.us_aqi[ni], pm25: h.pm2_5[ni], pm10: h.pm10[ni],
    ozone: h.ozone[ni], no2: h.nitrogen_dioxide[ni],
  };
  // peak AQI over the remaining forecast horizon (the "latest forecast")
  let peak = { aqi: -1, t: null };
  for (let i = ni; i < h.time.length; i++) {
    if (h.us_aqi[i] != null && h.us_aqi[i] > peak.aqi) peak = { aqi: h.us_aqi[i], t: h.time[i] };
  }
  return { source: "Open-Meteo", now, peak, series, link: airnowLink(lat, lon) };
}

// Deep link to the official AirNow.gov map centered on this location.
export function airnowLink(lat, lon) {
  return `https://www.airnow.gov/?city=&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
}

// ---- AirNow via proxy (optional upgrade) ----
async function px(path, params) {
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${AIRNOW_PROXY}${path}?${q}`);
  if (!r.ok) throw new Error(`AirNow proxy ${r.status}`);
  return r.json();
}
async function airnowOfficial(lat, lon) {
  const [obs, fc] = await Promise.all([
    px("/airnow/observation", { lat, lon }).catch(() => []),
    px("/airnow/forecast", { lat, lon }).catch(() => []),
  ]);
  return { source: "AirNow", observations: obs || [], forecasts: fc || [], series: [], link: airnowLink(lat, lon) };
}

export async function airQuality(lat, lon) {
  if (airnowConfigured()) {
    try { return await airnowOfficial(lat, lon); }
    catch { /* fall through to Open-Meteo */ }
  }
  return openMeteoAir(lat, lon);
}
