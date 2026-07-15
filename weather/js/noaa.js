// NOAA / NWS api.weather.gov client. CORS is open (ACAO:*). A User-Agent is
// "required" by the docs but browsers can't set that header; in practice the
// service serves the default browser UA fine. All temps normalized to °C,
// pressure to hPa, percentages 0–100.

const BASE = "https://api.weather.gov";

async function j(url) {
  const r = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!r.ok) throw new Error(`NWS ${r.status} for ${url.replace(BASE, "")}`);
  return r.json();
}

// unit-aware value extraction from an NWS quantity object {unitCode, value}
function toC(q) {
  if (!q || q.value == null) return null;
  const u = q.unitCode || "";
  if (u.includes("degF")) return ((q.value - 32) * 5) / 9;
  if (u.includes("K")) return q.value - 273.15;
  return q.value; // degC
}
function toHpa(q) {
  if (!q || q.value == null) return null;
  return (q.unitCode || "").includes("Pa") ? q.value / 100 : q.value;
}

// Resolve lat/lon -> {gridId, gridX, gridY, stations[], tz, city}
export async function points(lat, lon) {
  const d = await j(`${BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const p = d.properties;
  return {
    office: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    tz: p.timeZone,
    forecastGrid: p.forecastGridData,
    stationsUrl: p.observationStations,
    city: p.relativeLocation?.properties
      ? `${p.relativeLocation.properties.city}, ${p.relativeLocation.properties.state}`
      : null,
  };
}

// NWS time-series come as [{validTime: "2026-07-14T00:00:00+00:00/PT6H", value}].
// Expand each entry across its ISO-8601 duration into hourly samples.
function expandSeries(values, transform) {
  const out = [];
  if (!values) return out;
  for (const v of values) {
    const [start, dur] = v.validTime.split("/");
    const hours = parseIsoHours(dur);
    const t0 = new Date(start).getTime();
    const val = transform ? transform(v.value) : v.value;
    for (let h = 0; h < hours; h++) {
      out.push({ t: new Date(t0 + h * 36e5).toISOString().slice(0, 13) + ":00:00Z", value: val });
    }
  }
  return out;
}
function parseIsoHours(dur) {
  // PT6H, P1DT6H, PT1H … -> hours (rounded up, min 1)
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(dur) || [];
  const d = +(m[1] || 0), h = +(m[2] || 0), min = +(m[3] || 0);
  return Math.max(1, d * 24 + h + (min > 0 ? 1 : 0));
}

// Raw gridpoint forecast -> hourly records with the physical primitives.
// Note: NWS grids do NOT carry barometric pressure — Open-Meteo fills that.
export async function gridForecast(forecastGridUrl) {
  const d = await j(forecastGridUrl);
  const p = d.properties;
  const series = {
    tempC: expandSeries(p.temperature?.values),
    dewC: expandSeries(p.dewpoint?.values),
    rh: expandSeries(p.relativeHumidity?.values),
    cloud: expandSeries(p.skyCover?.values),
    precip: expandSeries(p.probabilityOfPrecipitation?.values),
  };
  // fold parallel series into one keyed-by-hour map
  const byT = new Map();
  for (const [field, arr] of Object.entries(series)) {
    for (const s of arr) {
      const rec = byT.get(s.t) || { t: s.t };
      rec[field] = s.value;
      byT.set(s.t, rec);
    }
  }
  return [...byT.values()].sort((a, b) => a.t.localeCompare(b.t));
}

// Recent measured observations from the nearest station (~last 7 days).
export async function observations(stationsUrl) {
  const st = await j(stationsUrl);
  const station = st.features?.[0]?.properties?.stationIdentifier;
  if (!station) return { station: null, obs: [] };
  const d = await j(`${BASE}/stations/${station}/observations?limit=200`);
  const obs = (d.features || [])
    .map((f) => {
      const o = f.properties;
      return {
        t: new Date(o.timestamp).toISOString().slice(0, 13) + ":00:00Z",
        tempC: toC(o.temperature),
        dewC: toC(o.dewpoint),
        rh: o.relativeHumidity?.value ?? null,
        cloud: cloudFromLayers(o.cloudLayers),
        precip: null, // observations report actual precip amount, not "chance"
        pressure: toHpa(o.barometricPressure) ?? toHpa(o.seaLevelPressure),
        measured: true,
      };
    })
    .filter((o) => o.tempC != null || o.pressure != null)
    .sort((a, b) => a.t.localeCompare(b.t));
  return { station, obs };
}

// METAR sky cover -> rough % cloud so measured cloud cover is plottable.
function cloudFromLayers(layers) {
  if (!layers || !layers.length) return null;
  const amt = { CLR: 0, SKC: 0, FEW: 20, SCT: 40, BKN: 75, OVC: 100, VV: 100 };
  return Math.max(...layers.map((l) => amt[l.amount] ?? 0));
}

// Active alerts for a point -> OEM/NWS warnings box.
export async function alerts(lat, lon) {
  const d = await j(`${BASE}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
  return (d.features || []).map((f) => ({
    event: f.properties.event,
    severity: f.properties.severity,
    headline: f.properties.headline,
    sender: f.properties.senderName,
    ends: f.properties.ends || f.properties.expires,
  }));
}
