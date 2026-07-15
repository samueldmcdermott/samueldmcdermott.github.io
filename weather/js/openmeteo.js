// Open-Meteo backbone. Key-free and CORS-clean. We use it for two things NWS
// can't give a browser client cleanly across the full ±10-day window:
//   1. surface_pressure (barometric) — absent from NWS forecast grids.
//   2. a continuous hourly series to gap-fill any field the NWS grid is missing
//      for a given hour (used only where NWS has no value).
// Past hours here are ERA5-style reanalysis; true station *measurements* from
// NWS observations still take precedence in the merge (see main.js).

export async function openMeteo(lat, lon, pastDays = 10, forecastDays = 10) {
  const hourly = [
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "cloud_cover",
    "precipitation_probability",
    "surface_pressure",
  ].join(",");
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${hourly}&past_days=${pastDays}&forecast_days=${forecastDays}` +
    "&temperature_unit=celsius&timezone=UTC";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  const h = d.hourly;
  if (!h || !h.time) return [];
  return h.time.map((t, i) => ({
    t: t.length === 16 ? t + ":00".slice(3) : t, // "YYYY-MM-DDTHH:MM" -> keep hour
    tempC: h.temperature_2m?.[i] ?? null,
    dewC: h.dew_point_2m?.[i] ?? null,
    rh: h.relative_humidity_2m?.[i] ?? null,
    cloud: h.cloud_cover?.[i] ?? null,
    precip: h.precipitation_probability?.[i] ?? null,
    pressure: h.surface_pressure?.[i] ?? null,
  })).map((rec) => ({ ...rec, t: normHour(rec.t) }));
}

// Normalize any ISO-ish stamp to "YYYY-MM-DDTHH:00" (UTC hour bucket).
function normHour(t) {
  const d = new Date(t.endsWith("Z") || t.includes("+") ? t : t + "Z");
  return d.toISOString().slice(0, 13) + ":00:00Z"; // UTC-hour key (explicit Z)
}
