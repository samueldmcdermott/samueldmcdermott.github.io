// "Current" readout + daily-summary hero for TODAY (local calendar day).
// Temperatures are reported in °F per spec, independent of the chart toggle.
//
// Boxes:
//   Current      — temp / dew point / AQI nearest to now.
//   Temperature  — AM low, high, PM low (with rough times).
//   Precipitation— max chance of precip and its time.
//   Dew point    — current spread, trend (rising/falling/stable within 1°F over
//                  the day), and whether the change is gradual or has a sharp
//                  hour (largest hourly delta well above the rest).
//   AQI          — max index and its time.
// Each box also carries a background sparkline of that field over the day.

import { cToF } from "./physics.js";

function recordsForDay(records, day = new Date()) {
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  return records.filter((r) => {
    const t = new Date(r.t); // r.t is a UTC instant; compare on the LOCAL date
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
}

const hourLabel = (rec) => new Date(rec.t).toLocaleTimeString(undefined, { hour: "numeric" });
const isAM = (rec) => new Date(rec.t).getHours() < 12;
const nonNull = (arr, key) => arr.filter((r) => r[key] != null && Number.isFinite(r[key]));

// nearest record to "now" that has a finite value for `key`
function nearestNow(records, key) {
  const now = Date.now();
  let best = null, bd = Infinity;
  for (const r of nonNull(records, key)) {
    const dt = Math.abs(new Date(r.t).getTime() - now);
    if (dt < bd) { bd = dt; best = r; }
  }
  return best;
}

function extremum(recs, key, pick) {
  let best = recs[0];
  for (const r of recs) if (pick(r[key], best[key])) best = r;
  return best;
}

// ---- CURRENT readout (temp / dew now from records; AQI passed in from the
// official AirNow box, since AQI isn't a chart series). ----
export function currentReadout(records, officialAqi = null) {
  const t = nearestNow(records, "tempC");
  const d = nearestNow(records, "dewC");
  if (!t && !d && officialAqi == null) return null;
  return {
    tempF: t ? cToF(t.tempC) : null,
    dewF: d ? cToF(d.dewC) : null,
    aqi: officialAqi,
    at: t ? hourLabel(t) : (d ? hourLabel(d) : null),
  };
}

// values arrays for the sparklines (in display units: °F for temp/dew, raw else)
function spark(recs, key, toF = false) {
  return nonNull(recs, key).map((r) => (toF ? cToF(r[key]) : r[key]));
}

// True if `d` is the local calendar today.
export function isToday(d) {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// ---- full day summary object for a given local day (default: today) ----
export function daySummary(records, dayDate = new Date()) {
  const day = recordsForDay(records, dayDate);
  const temps = nonNull(day, "tempC");
  if (temps.length < 2) return null;

  const today = isToday(dayDate);
  const dateLabel = dayDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    + (today ? " · Today" : "");

  // temperature: AM low, day high, PM low
  const high = extremum(temps, "tempC", (v, b) => v > b);
  const amT = temps.filter(isAM), pmT = temps.filter((r) => !isAM(r));
  const amLow = amT.length ? extremum(amT, "tempC", (v, b) => v < b) : null;
  const pmLow = pmT.length ? extremum(pmT, "tempC", (v, b) => v < b) : null;
  const temperature = {
    high: { f: cToF(high.tempC), at: hourLabel(high) },
    amLow: amLow ? { f: cToF(amLow.tempC), at: hourLabel(amLow) } : null,
    pmLow: pmLow ? { f: cToF(pmLow.tempC), at: hourLabel(pmLow) } : null,
    spark: spark(temps, "tempC", true),
  };

  // precipitation: max chance + time
  const precips = nonNull(day, "precip");
  const precipitation = precips.length
    ? (() => { const mx = extremum(precips, "precip", (v, b) => v > b);
        return { max: mx.precip, at: hourLabel(mx), spark: spark(precips, "precip") }; })()
    : null;

  // dew point: spread, trend, gradual-vs-sharp
  const dews = nonNull(day, "dewC");
  let dew = null;
  if (dews.length >= 2) {
    const valsF = dews.map((r) => cToF(r.dewC));
    const dLo = Math.min(...valsF), dHi = Math.max(...valsF);
    const first = valsF[0], last = valsF[valsF.length - 1];
    const net = last - first;
    // trend: stable if net change within ±1°F over the day
    const trend = Math.abs(net) <= 1 ? "stable" : net > 0 ? "rising" : "falling";
    // hourly deltas -> gradual if the biggest |delta| isn't an outlier
    const deltas = [];
    let sharp = null, maxAbs = -1;
    for (let i = 1; i < dews.length; i++) {
      const dtH = (new Date(dews[i].t) - new Date(dews[i - 1].t)) / 36e5;
      if (dtH <= 0) continue;
      const dv = (valsF[i] - valsF[i - 1]) / dtH;
      deltas.push(Math.abs(dv));
      if (Math.abs(dv) > maxAbs) { maxAbs = Math.abs(dv); sharp = dews[i]; }
    }
    // outlier test: is the largest delta clearly bigger than the typical one?
    const mean = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
    const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / (deltas.length || 1));
    const gradual = trend === "stable" || maxAbs <= mean + 2 * sd + 0.01;
    dew = {
      lo: dLo, hi: dHi, spread: dHi - dLo,
      trend, gradual,
      sharpAt: gradual ? null : (sharp ? hourLabel(sharp) : null),
      spark: valsF,
    };
  }

  // (AQI is official-AirNow current/daily only — not a per-hour summary tile.)
  return { dateLabel, today, temperature, precipitation, dew };
}

const fmtF = (f) => `${Math.round(f)}°F`;

// ---- CURRENT box ----
export function renderCurrent(c) {
  if (!c) return "";
  const cell = (k, v) => `<div class="cur-cell"><div class="cur-k">${k}</div><div class="cur-v">${v}</div></div>`;
  const nowTime = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `<div class="cur-title">At ${nowTime}</div>
  <div class="cur-row">
    ${cell("Temperature", c.tempF != null ? fmtF(c.tempF) : "—")}
    ${cell("Dew point", c.dewF != null ? fmtF(c.dewF) : "—")}
    ${cell("AQI", c.aqi != null ? Math.round(c.aqi) : "—")}
  </div>`;
}

// One summary tile with a background sparkline. `sparkOpts` tunes the scale
// (fixed min/max) and an optional reference line with hatched exceedance bands.
function tile(kicker, valueHtml, subHtml, sparkValues, sparkOpts) {
  return `<div class="hero-tile">
    ${sparkline(sparkValues, sparkOpts)}
    <div class="hero-content">
      <div class="hero-k">${kicker}</div>
      <div class="hero-v">${valueHtml}</div>
      <div class="hero-sub">${subHtml || ""}</div>
    </div>
  </div>`;
}

// ---- daily summary hero ----
export function renderSummary(s) {
  if (!s) return "";
  const tiles = [];

  // Temperature: AM low / high / PM low
  const t = s.temperature;
  const parts = [];
  if (t.amLow) parts.push(`AM low ${fmtF(t.amLow.f)} (${t.amLow.at})`);
  parts.push(`high ${fmtF(t.high.f)} (${t.high.at})`);
  if (t.pmLow) parts.push(`PM low ${fmtF(t.pmLow.f)} (${t.pmLow.at})`);
  tiles.push(tile(
    "Temperature",
    `${fmtF(t.amLow ? Math.min(t.amLow.f, t.pmLow ? t.pmLow.f : t.amLow.f) : t.high.f)} – ${fmtF(t.high.f)}`,
    parts.join(" · "),
    t.spark,
  ));

  // Precipitation: max chance + time (sparkline fixed to 0–100%)
  if (s.precipitation) {
    tiles.push(tile(
      "Precipitation",
      `${Math.round(s.precipitation.max)}%`,
      `max chance at ${s.precipitation.at}`,
      s.precipitation.spark,
      { min: 0, max: 100 },
    ));
  }

  // Dew point: big value = the day's range; sub = trend descriptor only.
  if (s.dew) {
    const d = s.dew;
    let sub = d.trend === "stable" ? "stable" : d.trend;
    if (d.trend !== "stable") sub += d.gradual ? ", gradual" : `, sharpest near ${d.sharpAt}`;
    tiles.push(tile(
      "Dew point",
      `${Math.round(d.lo)}–${Math.round(d.hi)}°F`,
      sub,
      d.spark,
    ));
  }

  // (No AQI tile: official AirNow is current + daily only, shown in the Air box.)

  const nav = `<div class="hero-nav">
    <button type="button" class="hero-arrow" data-day="prev" aria-label="Previous day">◀</button>
    <span class="hero-date">${s.dateLabel}</span>
    <button type="button" class="hero-arrow" data-day="next" aria-label="Next day">▶</button>
    ${s.today ? "" : `<button type="button" class="hero-today" data-day="today">Today</button>`}
  </div>`;
  return `${nav}<div class="hero-tiles">${tiles.join("")}</div>`;
}

// ---- sparkline: a tiny SVG path, no axes/labels, dashed gray line, for use as
// a panel background. `opts.min`/`opts.max` fix the scale (else auto). ----
export function sparkline(values, opts = {}, w = 200, h = 56) {
  if (!values || values.length < 2) return "";
  const lo = opts.min != null ? opts.min : Math.min(...values);
  const hi = opts.max != null ? opts.max : Math.max(...values);
  const span = hi - lo || 1;
  const pad = 4;
  const xw = w - pad * 2, yh = h - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * xw;
    const y = pad + (1 - (v - lo) / span) * yh;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const d = "M" + pts.join(" L");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--spark)" stroke-width="1.25" stroke-dasharray="3 3"/>
  </svg>`;
}
