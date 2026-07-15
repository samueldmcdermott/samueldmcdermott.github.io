// Hand-rolled multi-panel SVG chart. No libraries.
//
// Two layered SVGs share one vertical geometry:
//   • the SCROLLING plot SVG (#chart): per-panel framed boxes + gridlines +
//     6-hour vertical guides (clipped to each panel so panels read as separate
//     plots) + the series paths + the "now" rule.
//   • the FIXED overlay (#chartAxis): for each panel, its title, unit, y-axis
//     tick numbers, and a compact legend — pinned to the left edge so the scale
//     and identity stay visible no matter how far you scroll sideways.
//
// A grey band shades past hours. Units (°C/°F, hPa/inHg) are applied here so the
// same records can be re-rendered on toggle without refetching.

const NS = "http://www.w3.org/2000/svg";
const DAY_W = 96;
const PANEL_H = 118;
const PANEL_GAP = 30;      // vertical space between framed panels
export const AXIS_W = 108; // width of the fixed overlay gutter (title/legend/ticks)
const PLOT_L = AXIS_W + 6; // plot content starts right of the overlay so it's
                           // never hidden behind the sticky gutter at scroll 0
const PAD = { r: 16, t: 22, b: 34 };

// Field registry. Each field: panel, label, record key, unit family (for
// conversion), optional dash. Colors are assigned below as ONE running sequence
// through the palette (see COLOR_CYCLE), so the palette doesn't restart at every
// panel — colors may repeat across panels, but stay distinct within each panel.
export const FIELDS = {
  temperature: { panel: "temp",  label: "Temperature",      key: "tempC",    fam: "temp", default: true },
  dewPoint:    { panel: "temp",  label: "Dew point",        key: "dewC",     fam: "temp", default: true },
  wetBulb:     { panel: "temp",  label: "Wet-bulb",         key: "wetBulbC", fam: "temp", dash: "5 4" },
  cloudCover:  { panel: "pct",   label: "Cloud cover",      key: "cloud",    fam: "pct",  default: true },
  precip:      { panel: "pct",   label: "Precip chance",    key: "precip",   fam: "pct",  default: true, dash: "2 3" },
  humidity:    { panel: "pct",   label: "Rel. humidity",    key: "rh",       fam: "pct",  dash: "5 4" },
  pressure:    { panel: "pres",  label: "Barometric pressure", key: "pressure", fam: "pres", default: true },
  vaporPressure:{panel: "vapor", label: "Vapor pressure",   key: "vaporP",   fam: "pres" },
  satVapor:    { panel: "vapor", label: "Sat. vapor pressure", key: "satVaporP", fam: "pres", dash: "5 4" },
  // Air-quality index panel (0–500, all same units). AQI is the max envelope of
  // the four sub-indices, so they legitimately share one plot.
  aqi:         { panel: "aqi",   label: "US AQI (overall)", key: "aqi",      fam: "aqi",  default: true },
  aqiPm25:     { panel: "aqi",   label: "AQI · PM2.5",      key: "aqiPm25",  fam: "aqi",  dash: "5 4" },
  aqiPm10:     { panel: "aqi",   label: "AQI · PM10",       key: "aqiPm10",  fam: "aqi",  dash: "5 4" },
  aqiOzone:    { panel: "aqi",   label: "AQI · Ozone",      key: "aqiOzone", fam: "aqi",  dash: "5 4" },
  aqiNo2:      { panel: "aqi",   label: "AQI · NO₂",        key: "aqiNo2",   fam: "aqi",  dash: "5 4" },
  // Raw concentrations panel (µg/m³) — a physically different scale.
  pm25:        { panel: "poll",  label: "PM2.5",            key: "pm25",     fam: "conc" },
  pm10:        { panel: "poll",  label: "PM10",             key: "pm10",     fam: "conc" },
  ozone:       { panel: "poll",  label: "Ozone",            key: "ozone",    fam: "conc" },
  no2:         { panel: "poll",  label: "NO₂",              key: "no2",      fam: "conc" },
};

// Assign colors as a single continuous walk through the 8-color palette across
// the whole registry (in declaration order), rather than restarting per panel.
// With ≤5 fields per panel and 8 colors, this keeps every panel internally
// distinct while giving a pleasing progression instead of lockstep repeats.
const COLOR_CYCLE = 8; // --c-1 .. --c-8
Object.values(FIELDS).forEach((spec, i) => {
  spec.color = `var(--c-${(i % COLOR_CYCLE) + 1})`;
});

// Panel titles are unit-aware (temp/pres depend on the toggle).
function panelTitle(panelKey, units) {
  switch (panelKey) {
    case "temp":  return `Temperature (${units.temp === "F" ? "°F" : "°C"})`;
    case "pct":   return "Percent (%)";
    case "pres":  return `Pressure (${units.pres})`;
    case "vapor": return `Vapor pressure (${units.pres})`;
    case "aqi":   return "Air quality index (0–500)";
    case "poll":  return "Pollutants (µg/m³)";
  }
  return panelKey;
}
const PANEL_ORDER = ["temp", "pct", "pres", "vapor", "aqi", "poll"];

// ---- unit conversion ----
function convert(v, fam, units) {
  if (v == null || !Number.isFinite(v)) return v;
  if (fam === "temp" && units.temp === "F") return (v * 9) / 5 + 32;
  if (fam === "pres" && units.pres === "inHg") return v * 0.0295299830714;
  return v;
}

const el = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

function activePanels(enabled) {
  const used = new Set(enabled.map((f) => FIELDS[f]?.panel).filter(Boolean));
  return PANEL_ORDER.filter((p) => used.has(p));
}
const slotH = () => PANEL_H + PANEL_GAP;

// Public. mount = scrolling plot; axisMount = fixed overlay. units = {temp,pres}.
// Returns geometry used by the hover layer in main.js.
export function renderChart(mount, records, enabled, axisMount, units = { temp: "F", pres: "hPa" }) {
  mount.innerHTML = "";
  if (axisMount) axisMount.innerHTML = "";
  if (!records.length) return { width: 0, nowX: 0, panelGeo: [], xToTime: null };

  const panels = activePanels(enabled);
  const t0 = new Date(records[0].t).getTime();
  const t1 = new Date(records[records.length - 1].t).getTime();
  const spanH = Math.max(1, (t1 - t0) / 36e5);
  const plotW = (spanH / 24) * DAY_W;
  const originX = PLOT_L;
  const W = originX + plotW + PAD.r;
  const H = PAD.t + panels.length * slotH() + PAD.b;

  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
  const xOf = (t) => originX + ((new Date(t).getTime() - t0) / 36e5 / spanH) * plotW;
  const xToTime = (x) => new Date(t0 + ((x - originX) / plotW) * spanH * 36e5);
  const nowX = xOf(new Date().toISOString());

  // per-panel geometry (domain in DISPLAY units, so ticks/paths agree)
  const panelGeo = panels.map((panelKey, pi) => {
    const top = PAD.t + pi * slotH();
    const fieldsHere = enabled.filter((f) => FIELDS[f]?.panel === panelKey);
    let lo = Infinity, hi = -Infinity;
    for (const f of fieldsHere) {
      const spec = FIELDS[f];
      for (const r of records) {
        const v = convert(r[spec.key], spec.fam, units);
        if (v != null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    if (panelKey === "pct") { lo = 0; hi = 100; }
    // AQI: pin to 0 and always show at least up to 100, so the Good/Moderate/
    // Unhealthy-for-Sensitive reference lines (50, 100) are always visible.
    if (panelKey === "aqi") { lo = 0; hi = Math.max(hi, 100); }
    const yOf = (v) => top + PANEL_H - ((v - lo) / (hi - lo)) * PANEL_H;
    return { panelKey, top, fieldsHere, lo, hi, yOf, title: panelTitle(panelKey, units) };
  });

  // ---- past shade behind everything (full height) ----
  const shadeW = Math.max(0, Math.min(nowX, originX + plotW) - originX);
  if (shadeW > 0) svg.appendChild(el("rect", { class: "past-shade", x: originX, y: PAD.t, width: shadeW, height: H - PAD.t - PAD.b }));

  // ---- per-panel framed plots ----
  for (const g of panelGeo) {
    const box = { x: originX, y: g.top, w: plotW, h: PANEL_H };
    // frame
    svg.appendChild(el("rect", { class: "panel-frame", x: box.x, y: box.y, width: box.w, height: box.h }));

    // time guides CLIPPED to this panel's box (so panels read as separate plots)
    drawTimeGuides(svg, records, t0, t1, xOf, g.top, g.top + PANEL_H, {
      isLast: g === panelGeo[panelGeo.length - 1],
      isFirst: g === panelGeo[0],
    });

    // horizontal gridlines
    for (let k = 0; k <= 2; k++) {
      const v = g.lo + ((g.hi - g.lo) * k) / 2;
      const y = g.yOf(v);
      if (k !== 0 && k !== 2) svg.appendChild(el("line", { class: "grid-line", x1: box.x, y1: y, x2: box.x + box.w, y2: y }));
    }

    // AQI reference lines: 50 (Good→Moderate, dotted gray) and 100
    // (Moderate→Unhealthy for Sensitive, thick). Drawn under the series.
    if (g.panelKey === "aqi") {
      for (const ref of [{ v: 50, cls: "aqi-ref-50" }, { v: 100, cls: "aqi-ref-100" }]) {
        if (ref.v > g.hi) continue;
        const y = g.yOf(ref.v);
        svg.appendChild(el("line", { class: ref.cls, x1: box.x, y1: y, x2: box.x + box.w, y2: y }));
      }
    }

    // series
    for (const f of g.fieldsHere) {
      const spec = FIELDS[f];
      drawSeries(svg, records, spec, xOf, g.yOf, nowX, units);
    }
  }

  // ---- now rule on top, spanning all panels ----
  if (nowX >= originX && nowX <= originX + plotW) {
    svg.appendChild(el("line", { class: "now-rule", x1: nowX, y1: PAD.t, x2: nowX, y2: H - PAD.b }));
    const t = el("text", { class: "now-txt", x: nowX + 4, y: PAD.t - 8 });
    t.textContent = "now";
    svg.appendChild(t);
  }

  mount.appendChild(svg);

  // ---- fixed overlay: title + unit + y-ticks + legend per panel ----
  if (axisMount) drawOverlay(axisMount, panelGeo, H);

  return { width: W, nowX, panelGeo, xToTime, xOf, originX, plotW, t0, t1, spanH, height: H, units };
}

// Vertical guides at 6h boundaries, drawn only within [yTop,yBot] so each panel
// reads as its own plot. Date labels sit above the FIRST panel; the rotated
// 6am/noon/6pm time labels go beneath the LAST panel only.
function drawTimeGuides(svg, records, t0, t1, xOf, yTop, yBot, { isLast, isFirst }) {
  const start = new Date(records[0].t);
  start.setHours(0, 0, 0, 0);
  const SIX_H = 6 * 36e5;
  for (let ms = start.getTime(); ms <= t1; ms += SIX_H) {
    if (ms < t0) continue;
    const d = new Date(ms);
    const hr = d.getHours();
    const x = xOf(d.toISOString());
    const midnight = hr === 0;
    svg.appendChild(el("line", { class: midnight ? "grid-day" : "tick6-line", x1: x, y1: yTop, x2: x, y2: yBot }));
    if (midnight && isFirst) {
      const lbl = d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
      const t = el("text", { class: "tick-txt", x: x + 3, y: yTop - 6 });
      t.textContent = lbl;
      svg.appendChild(t);
    }
    if (isLast) {
      const label = hr === 6 ? "6am" : hr === 12 ? "noon" : hr === 18 ? "6pm" : hr === 0 ? "12am" : "";
      if (label) {
        const t = el("text", { class: "tick6-txt", x, y: yBot + 5, transform: `rotate(90 ${x} ${yBot + 5})` });
        t.textContent = label;
        svg.appendChild(t);
      }
    }
  }
}

function drawSeries(svg, records, spec, xOf, yOf, nowX, units) {
  const pts = records
    .map((r) => {
      const v = convert(r[spec.key], spec.fam, units);
      return { x: xOf(r.t), y: v != null && Number.isFinite(v) ? yOf(v) : null };
    })
    .filter((p) => p.y != null);
  if (!pts.length) return;
  const seg = (subset, cls, opacity) => {
    if (subset.length < 1) return;
    let d = "";
    subset.forEach((p, i) => { d += (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1) + " "; });
    const path = el("path", { class: `series-line ${cls}`, d, stroke: spec.color, opacity });
    if (spec.dash) path.setAttribute("stroke-dasharray", spec.dash);
    svg.appendChild(path);
  };
  seg(pts.filter((p) => p.x <= nowX + 0.5), "past", 0.95);
  seg(pts.filter((p) => p.x >= nowX - 0.5), "future", 0.85);
}

// Fixed left gutter: per panel -> title (unit), 3 y-ticks, compact legend.
function drawOverlay(axisMount, panelGeo, H) {
  const svg = el("svg", { width: AXIS_W, height: H, viewBox: `0 0 ${AXIS_W} ${H}` });
  for (const g of panelGeo) {
    // title (sticky)
    const title = el("text", { class: "panel-title", x: 6, y: g.top - 8 });
    title.textContent = g.title;
    svg.appendChild(title);
    // y ticks (sticky)
    for (let k = 0; k <= 2; k++) {
      const v = g.lo + ((g.hi - g.lo) * k) / 2;
      const y = g.yOf(v);
      const t = el("text", { class: "tick-txt", x: AXIS_W - 6, y: y + 3, "text-anchor": "end" });
      t.textContent = fmtTick(v);
      svg.appendChild(t);
    }
    // legend (sticky), stacked vertically to fit the narrow gutter
    let ly = g.top + 12;
    for (const f of g.fieldsHere) {
      const spec = FIELDS[f];
      const line = el("line", { class: "legend-swatch", x1: 6, y1: ly, x2: 20, y2: ly, stroke: spec.color });
      if (spec.dash) line.setAttribute("stroke-dasharray", spec.dash);
      svg.appendChild(line);
      const txt = el("text", { class: "legend-txt", x: 25, y: ly + 3 });
      txt.textContent = spec.label;
      svg.appendChild(txt);
      ly += 14;
    }
  }
  axisMount.appendChild(svg);
}

function fmtTick(v) {
  const a = Math.abs(v);
  if (a !== 0 && a < 10) return v.toFixed(1);
  return v.toFixed(0);
}
