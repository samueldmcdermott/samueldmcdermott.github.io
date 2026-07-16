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

// ---- CURRENT readout (temp / dew / AQI right now) ----
export function currentReadout(records) {
  const t = nearestNow(records, "tempC");
  const d = nearestNow(records, "dewC");
  const a = nearestNow(records, "aqi");
  if (!t && !d && !a) return null;
  return {
    tempF: t ? cToF(t.tempC) : null,
    dewF: d ? cToF(d.dewC) : null,
    aqi: a ? a.aqi : null,
    at: t ? hourLabel(t) : (d ? hourLabel(d) : null),
  };
}

// values arrays for the sparklines (in display units: °F for temp/dew, raw else)
function spark(recs, key, toF = false) {
  return nonNull(recs, key).map((r) => (toF ? cToF(r[key]) : r[key]));
}

// ---- full day summary object ----
export function daySummary(records) {
  const day = recordsForDay(records);
  const temps = nonNull(day, "tempC");
  if (temps.length < 2) return null;

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

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
      current: nearestNow(records, "dewC") ? cToF(nearestNow(records, "dewC").dewC) : null,
      lo: dLo, hi: dHi, spread: dHi - dLo,
      trend, gradual,
      sharpAt: gradual ? null : (sharp ? hourLabel(sharp) : null),
      spark: valsF,
    };
  }

  // AQI: max + time
  const aqis = nonNull(day, "aqi");
  const aqi = aqis.length
    ? (() => { const mx = extremum(aqis, "aqi", (v, b) => v > b);
        return { max: mx.aqi, at: hourLabel(mx), spark: spark(aqis, "aqi") }; })()
    : null;

  return { dateLabel, temperature, precipitation, dew, aqi };
}

const fmtF = (f) => `${Math.round(f)}°F`;

// ---- CURRENT box ----
export function renderCurrent(c) {
  if (!c) return "";
  const cell = (k, v) => `<div class="cur-cell"><div class="cur-k">${k}</div><div class="cur-v">${v}</div></div>`;
  return `<div class="cur-row">
    ${cell("Temperature", c.tempF != null ? fmtF(c.tempF) : "—")}
    ${cell("Dew point", c.dewF != null ? fmtF(c.dewF) : "—")}
    ${cell("US AQI", c.aqi != null ? Math.round(c.aqi) : "—")}
  </div>`;
}

// One summary tile with a background sparkline.
function tile(kicker, valueHtml, subHtml, sparkValues) {
  return `<div class="hero-tile">
    ${sparkline(sparkValues)}
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

  // Precipitation: max chance + time
  if (s.precipitation) {
    tiles.push(tile(
      "Precipitation",
      `${Math.round(s.precipitation.max)}%`,
      `max chance at ${s.precipitation.at}`,
      s.precipitation.spark,
    ));
  }

  // Dew point: spread + trend + gradual/sharp
  if (s.dew) {
    const d = s.dew;
    const trendWord = d.trend === "stable" ? "stable" : d.trend;
    let sub = `spread ${Math.round(d.lo)}–${Math.round(d.hi)}°F · ${trendWord}`;
    if (d.trend !== "stable") sub += d.gradual ? ", gradual" : `, sharpest near ${d.sharpAt}`;
    tiles.push(tile(
      "Dew point",
      d.current != null ? fmtF(d.current) : `${Math.round(d.lo)}–${Math.round(d.hi)}°F`,
      sub,
      d.spark,
    ));
  }

  // AQI: max + time
  if (s.aqi) {
    tiles.push(tile("US AQI", `${Math.round(s.aqi.max)}`, `max at ${s.aqi.at}`, s.aqi.spark));
  }

  return `<div class="hero-date">${s.dateLabel}</div><div class="hero-tiles">${tiles.join("")}</div>`;
}

// ---- sparkline: a tiny SVG path, no axes/labels, dashed gray line, for use as
// a panel background. Values auto-scaled to the box. ----
export function sparkline(values, w = 200, h = 56) {
  if (!values || values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
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
