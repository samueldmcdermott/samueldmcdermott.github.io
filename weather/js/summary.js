// Daily-summary "hero" for TODAY (local calendar day). All temperatures are
// reported in °F per the summary spec, independent of the chart's unit toggle.
//
// Contents:
//   • high / low temperature, with the low tagged AM or PM.
//   • dew point: if its range over the day is ≤ 6°F, "mean ±half-range";
//     otherwise the full range PLUS the hour of its steepest change (max |d/dt|).

import { cToF } from "./physics.js";

// Records whose local calendar date matches `day` (default: today).
function recordsForDay(records, day = new Date()) {
  const y = day.getFullYear(), m = day.getMonth(), d = day.getDate();
  return records.filter((r) => {
    const t = new Date(r.t); // r.t is a UTC instant; compare in LOCAL date
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
}

const fmtF = (f) => `${Math.round(f)}°F`;
// "3 PM", "11 AM" — local hour of a record.
function hourLabel(rec) {
  return new Date(rec.t).toLocaleTimeString(undefined, { hour: "numeric" });
}
function isAM(rec) {
  return new Date(rec.t).getHours() < 12;
}

// Compute the summary object, or null if there isn't enough data for today.
export function daySummary(records) {
  const day = recordsForDay(records);
  const temps = day.filter((r) => r.tempC != null && Number.isFinite(r.tempC));
  if (temps.length < 2) return null;

  // high / low (by °F, but °C ordering is identical)
  let hi = temps[0], lo = temps[0];
  for (const r of temps) {
    if (r.tempC > hi.tempC) hi = r;
    if (r.tempC < lo.tempC) lo = r;
  }

  // ---- dew point ----
  const dews = day.filter((r) => r.dewC != null && Number.isFinite(r.dewC));
  let dew = null;
  if (dews.length) {
    const valsF = dews.map((r) => cToF(r.dewC));
    const dLo = Math.min(...valsF), dHi = Math.max(...valsF);
    const range = dHi - dLo;
    const mean = valsF.reduce((a, b) => a + b, 0) / valsF.length;
    if (range <= 6) {
      dew = { mode: "steady", mean, half: range / 2, lo: dLo, hi: dHi };
    } else {
      // steepest change: max |Δ°F per hour| between consecutive hourly samples.
      let steepest = null, maxSlope = -1;
      for (let i = 1; i < dews.length; i++) {
        const dtH = (new Date(dews[i].t) - new Date(dews[i - 1].t)) / 36e5;
        if (dtH <= 0) continue;
        const slope = Math.abs((cToF(dews[i].dewC) - cToF(dews[i - 1].dewC)) / dtH);
        if (slope > maxSlope) { maxSlope = slope; steepest = dews[i]; }
      }
      dew = { mode: "swing", lo: dLo, hi: dHi, steepest, slope: maxSlope };
    }
  }

  return {
    dateLabel: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    high: { f: cToF(hi.tempC), at: hourLabel(hi) },
    low: { f: cToF(lo.tempC), at: hourLabel(lo), part: isAM(lo) ? "AM" : "PM" },
    dew,
  };
}

// Render the summary object to HTML for the hero element.
export function renderSummary(s) {
  if (!s) return "";
  const tiles = [];

  tiles.push(`
    <div class="hero-tile">
      <div class="hero-k">High</div>
      <div class="hero-v">${fmtF(s.high.f)}</div>
      <div class="hero-sub">at ${s.high.at}</div>
    </div>`);

  tiles.push(`
    <div class="hero-tile">
      <div class="hero-k">Low</div>
      <div class="hero-v">${fmtF(s.low.f)}</div>
      <div class="hero-sub">at ${s.low.at} (${s.low.part})</div>
    </div>`);

  if (s.dew) {
    if (s.dew.mode === "steady") {
      // mean ± half-range, both rounded; ± value ≥ 0
      const pm = Math.max(0, Math.round(s.dew.half));
      tiles.push(`
        <div class="hero-tile">
          <div class="hero-k">Dew point</div>
          <div class="hero-v">${Math.round(s.dew.mean)}<span class="hero-pm"> ± ${pm}</span>°F</div>
          <div class="hero-sub">steady (range ≤ 6°F)</div>
        </div>`);
    } else {
      tiles.push(`
        <div class="hero-tile">
          <div class="hero-k">Dew point</div>
          <div class="hero-v">${Math.round(s.dew.lo)}–${Math.round(s.dew.hi)}°F</div>
          <div class="hero-sub">fastest change near ${s.dew.steepest ? hourLabel(s.dew.steepest) : "—"}</div>
        </div>`);
    }
  }

  return `<div class="hero-date">${s.dateLabel}</div><div class="hero-tiles">${tiles.join("")}</div>`;
}
