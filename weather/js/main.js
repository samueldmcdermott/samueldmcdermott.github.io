// Orchestration: search -> geocode -> fetch (NWS + Open-Meteo + observations)
// -> merge into one hourly series -> derive physics -> render chart + boxes.

import { geocode } from "./geocode.js";
import * as noaa from "./noaa.js";
import { openMeteo } from "./openmeteo.js";
import { moonPhase } from "./moon.js";
import { airQuality, aqiCategory } from "./airnow.js";
import { wetBulb, vaporPressure, saturationVaporPressure, cToF, hPaToInHg } from "./physics.js";
import * as store from "./store.js";
import { renderChart, FIELDS, AXIS_W } from "./chart.js";
import { daySummary, renderSummary, currentReadout, renderCurrent, isToday } from "./summary.js";

const $ = (id) => document.getElementById(id);
// Session-only defaults (not persisted). Only the location is kept — in the URL.
let enabled = ["temperature", "cloudCover", "precip", "pressure", "dewPoint", "aqi"];
let units = { temp: "F", pres: "hPa" };
let currentRecords = [];
let chartInfo = null; // geometry returned by renderChart, for the hover layer
let selectedDay = new Date(); // which local day the summary hero shows

// ---------- theme (same pattern as the other apps) ----------
(function theme() {
  const saved = localStorage.getItem("wx.theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  $("themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("wx.theme", next);
    if (currentRecords.length) draw(); // recolor SVG
  });
})();

// Prose definitions shown by the (i) button on certain chips. The relationship
// is given in the most natural form: the three sit in a fixed order.
const FIELD_INFO = {
  dewPoint: `<b>Dew point</b> is the temperature a surface must reach for
    condensation (dew) to form on it — equivalently, the temperature at which the
    current air would become saturated. Higher dew point = more humid, muggier air.`,
  wetBulb: `<b>Wet-bulb temperature</b> is the lowest temperature a surface can
    reach by evaporative cooling alone (a wet thermometer in moving air). It sets
    how well sweat can cool a body.<br><br>
    The three always order as
    <b>dew&nbsp;point ≤ wet&nbsp;bulb ≤ air&nbsp;temperature</b>,
    with equality only at 100% humidity (saturated air).`,
};

// ---------- field toggle chips ----------
function buildToggles() {
  const host = $("fieldToggles");
  host.innerHTML = "";
  for (const [id, spec] of Object.entries(FIELDS)) {
    const wrap = document.createElement("span");
    wrap.className = "chip-wrap";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", enabled.includes(id) ? "true" : "false");
    chip.style.setProperty("--dot", spec.color);
    chip.innerHTML = `<span class="swatch"></span>${spec.label}`;
    chip.addEventListener("click", () => {
      if (enabled.includes(id)) enabled = enabled.filter((f) => f !== id);
      else enabled.push(id);
      chip.setAttribute("aria-pressed", enabled.includes(id) ? "true" : "false");
      draw();
    });
    wrap.appendChild(chip);

    // (i) info button for fields with a definition
    if (FIELD_INFO[id]) {
      const info = document.createElement("button");
      info.type = "button";
      info.className = "info-btn";
      info.textContent = "ⓘ";
      info.setAttribute("aria-label", `About ${spec.label}`);
      info.addEventListener("click", (e) => { e.stopPropagation(); toggleInfoPopover(info, FIELD_INFO[id]); });
      wrap.appendChild(info);
    }

    host.appendChild(wrap);
  }
}

// A single shared popover for (i) buttons; click the same button (or anywhere
// else) to dismiss. Positioned under the button.
let infoAnchor = null;
function toggleInfoPopover(btn, html) {
  const pop = $("infoPopover");
  if (infoAnchor === btn && !pop.hidden) { pop.hidden = true; infoAnchor = null; return; }
  infoAnchor = btn;
  pop.innerHTML = html;
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
}
addEventListener("click", (e) => {
  const pop = $("infoPopover");
  if (pop.hidden) return;
  if (e.target.closest(".info-btn") || e.target.closest("#infoPopover")) return;
  pop.hidden = true; infoAnchor = null;
});

// ---------- merge sources into one hourly record map ----------
// Precedence for each hour/field: measured NWS observation > NWS forecast >
// Open-Meteo. Pressure only exists in observations + Open-Meteo. (AQI is NOT a
// chart series — it comes from official AirNow and lives only in the Air box.)
function mergeAll({ omRecords, nwsForecast, observed }) {
  const byT = new Map();
  const WEATHER = ["tempC", "dewC", "rh", "cloud", "precip", "pressure"];
  const put = (rec, keys, { measuredFlag = false } = {}) => {
    const cur = byT.get(rec.t) || { t: rec.t };
    for (const k of keys) {
      if (rec[k] != null && Number.isFinite(rec[k])) {
        // don't let a lower-precedence source overwrite an existing measured value
        if (cur[k] == null || !cur.measured) cur[k] = rec[k];
      }
    }
    if (measuredFlag) cur.measured = true;
    byT.set(rec.t, cur);
  };
  // lowest precedence first
  omRecords.forEach((r) => put(r, WEATHER));
  nwsForecast.forEach((r) => put(r, WEATHER));
  observed.forEach((r) => put(r, WEATHER, { measuredFlag: true }));

  const recs = [...byT.values()].sort((a, b) => a.t.localeCompare(b.t));
  // derive physical quantities per hour
  for (const r of recs) {
    r.wetBulbC = wetBulb({ tempC: r.tempC, dewC: r.dewC, rh: r.rh });
    r.vaporP = vaporPressure({ tempC: r.tempC, dewC: r.dewC, rh: r.rh });
    r.satVaporP = r.tempC != null ? saturationVaporPressure(r.tempC) : null;
  }
  return recs;
}

// ---------- unit toggles ----------
(function unitToggles() {
  const btns = document.querySelectorAll(".unit-toggle button");
  const sync = () => btns.forEach((b) =>
    b.setAttribute("aria-pressed", units[b.dataset.unit] === b.dataset.val ? "true" : "false"));
  btns.forEach((b) => b.addEventListener("click", () => {
    units = { ...units, [b.dataset.unit]: b.dataset.val };
    sync();
    if (currentRecords.length) draw();
  }));
  sync();
})();

// ---------- chart draw + scroll wiring ----------
function draw() {
  chartInfo = renderChart($("chart"), currentRecords, enabled, $("chartAxis"), units);
  hideTip();
}

// midnight (local) of the day containing a record time
function dayFloor(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// The span of local days that have data, from the records.
function dayBounds() {
  if (!currentRecords.length) return null;
  const first = dayFloor(new Date(currentRecords[0].t));
  const last = dayFloor(new Date(currentRecords[currentRecords.length - 1].t));
  return { first, last };
}

// Latest official AirNow current AQI, set by drawAir (null until it loads).
let officialAqi = null;

// The Current-box "details" link smooth-scrolls to (and briefly highlights) the
// Air-quality box, instead of an abrupt hash jump.
$("current").addEventListener("click", (e) => {
  const link = e.target.closest("[data-scroll]");
  if (!link) return;
  e.preventDefault();
  const target = $(link.dataset.scroll);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 1200);
});

// "Current" readout (always now) + daily-summary hero for `selectedDay`.
function drawHero() {
  const cur = $("current");
  const c = currentReadout(currentRecords, officialAqi);
  if (c) { cur.innerHTML = renderCurrent(c); cur.hidden = false; } else { cur.hidden = true; }

  const hero = $("hero");
  const s = daySummary(currentRecords, selectedDay);
  if (!s) { hero.hidden = true; return; }
  hero.innerHTML = renderSummary(s);
  hero.hidden = false;
}

// Move the summary to another day, clamped to the available range, then redraw.
function changeDay(delta) {
  const b = dayBounds();
  if (!b) return;
  let next = delta === "today" ? dayFloor(new Date()) : new Date(selectedDay);
  if (delta === "prev") next.setDate(next.getDate() - 1);
  if (delta === "next") next.setDate(next.getDate() + 1);
  next = dayFloor(next);
  if (next < b.first) next = b.first;
  if (next > b.last) next = b.last;
  selectedDay = next;
  drawHero();
}

// Delegated clicks for the hero's day-nav buttons.
$("hero").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-day]");
  if (btn) changeDay(btn.dataset.day);
});

// Swipe left/right on the hero to change day (mobile + trackpad drag).
(function heroSwipe() {
  const hero = $("hero");
  let x0 = null;
  hero.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
  hero.addEventListener("pointerup", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) < 40) return;          // ignore taps / tiny moves
    if (e.target.closest("[data-day]")) return; // let button clicks handle themselves
    changeDay(dx < 0 ? "next" : "prev");    // swipe left -> next day
  });
})();

// Default & "now" button: open the view at the start of *today* (local
// midnight) on the left, so today + the future are in view. A small inset keeps
// that edge clear of the fixed y-axis overlay.
function scrollToNow() {
  const vp = $("chartViewport");
  if (!vp.querySelector("svg") || !chartInfo?.xOf) return;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0); // today, local midnight
  const inset = 56; // px in from the left (past the y-axis overlay)
  vp.scrollLeft = Math.max(0, chartInfo.xOf(midnight.toISOString()) - inset);
}

let dragging = false; // shared so hover doesn't fight a drag-scroll
(function scrollNav() {
  const vp = $("chartViewport");
  $("scrollLeft").addEventListener("click", () => vp.scrollBy({ left: -DAY(), behavior: "smooth" }));
  $("scrollRight").addEventListener("click", () => vp.scrollBy({ left: DAY(), behavior: "smooth" }));
  $("scrollNow").addEventListener("click", scrollToNow);
  // drag-to-scroll (pointer) in addition to native touch swipe
  let down = false, moved = false, startX = 0, startL = 0;
  vp.addEventListener("pointerdown", (e) => { down = true; moved = false; startX = e.clientX; startL = vp.scrollLeft; });
  vp.addEventListener("pointermove", (e) => {
    if (!down) return;
    if (Math.abs(e.clientX - startX) > 3) { moved = true; dragging = true; vp.setPointerCapture(e.pointerId); }
    if (moved) { vp.scrollLeft = startL - (e.clientX - startX); hideTip(); }
  });
  const end = () => { down = false; setTimeout(() => (dragging = false), 0); };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
  vp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") vp.scrollBy({ left: -DAY(), behavior: "smooth" });
    if (e.key === "ArrowRight") vp.scrollBy({ left: DAY(), behavior: "smooth" });
  });
  function DAY() { return Math.round(vp.clientWidth / 3); }
})();

// ---------- hover tooltip: nearest hourly record under the cursor ----------
function hideTip() {
  $("chartTip").hidden = true;
  $("chartCross").hidden = true;
}
// value formatters that respect the active units
function fmtVal(key, v) {
  if (v == null || !Number.isFinite(v)) return "—";
  switch (key) {
    case "tempC": case "dewC": case "wetBulbC":
      return units.temp === "F" ? `${(v * 9 / 5 + 32).toFixed(1)}°F` : `${v.toFixed(1)}°C`;
    case "pressure": case "vaporP": case "satVaporP":
      return units.pres === "inHg" ? `${(v * 0.0295299830714).toFixed(2)} inHg` : `${v.toFixed(0)} hPa`;
    case "cloud": case "precip": case "rh": return `${Math.round(v)}%`;
    case "aqi": case "aqiPm25": case "aqiPm10": case "aqiOzone": case "aqiNo2":
      return `${Math.round(v)}`; // dimensionless index
    default: return `${Math.round(v)} µg/m³`; // pollutant concentrations
  }
}
// Show the tooltip + crosshair for the record nearest to a client x/y. Shared by
// desktop hover (pointermove) and mobile tap-to-inspect (pointerup w/o drag).
function showTipAt(clientX, clientY) {
  const vp = $("chartViewport"), tip = $("chartTip"), cross = $("chartCross");
  if (!chartInfo || !currentRecords.length) return;
  const rect = vp.getBoundingClientRect();
  // x within the SVG coordinate space = viewport x + how far we've scrolled
  const svgX = clientX - rect.left + vp.scrollLeft;
  if (svgX < chartInfo.originX) { hideTip(); return; }
  // nearest record by time
  const time = chartInfo.xToTime(svgX);
  let rec = null, best = Infinity;
  for (const r of currentRecords) {
    const dt = Math.abs(new Date(r.t).getTime() - time.getTime());
    if (dt < best) { best = dt; rec = r; }
  }
  if (!rec || best > 90 * 60 * 1000) { hideTip(); return; } // >90min away: gap
  // crosshair at the record's x, in viewport (client) coords
  const recX = chartInfo.xOf(rec.t) - vp.scrollLeft;
  cross.style.left = `${recX}px`; cross.hidden = false;
  // tooltip content: only the ENABLED fields that have a value
  const when = new Date(rec.t).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric" });
  const past = new Date(rec.t).getTime() <= Date.now();
  let rows = "";
  for (const f of enabled) {
    const spec = FIELDS[f];
    const val = rec[spec.key];
    if (val == null || !Number.isFinite(val)) continue;
    rows += `<div class="tip-row"><span class="tip-k"><span class="tip-dot" style="background:${spec.color}"></span>${spec.label}</span><span>${fmtVal(spec.key, val)}</span></div>`;
  }
  if (!rows) { hideTip(); return; }
  tip.innerHTML = `<div class="tip-t">${when}${past ? " · measured/past" : ""}</div>${rows}`;
  tip.hidden = false;
  // position the tip near the point but keep it inside the frame
  const frame = vp.parentElement.getBoundingClientRect();
  let tx = recX + 14;
  if (tx + tip.offsetWidth > frame.width - 6) tx = recX - tip.offsetWidth - 14;
  tip.style.left = `${Math.max(6, tx)}px`;
  tip.style.top = `${Math.min(clientY - rect.top + 8, frame.height - tip.offsetHeight - 6)}px`;
}

(function hover() {
  const vp = $("chartViewport");
  // Desktop: continuous hover via a real (mouse/pen) pointer.
  vp.addEventListener("pointermove", (e) => {
    if (dragging || e.pointerType === "touch") return; // touch handled by tap below
    showTipAt(e.clientX, e.clientY);
  });
  vp.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch") hideTip(); // keep a tapped tip visible on mobile
  });
  // Mobile: tap-to-inspect. A touch that ended without scrolling (didn't move)
  // is a tap -> show the values at that point; the tip stays until the next tap
  // or scroll. `dragging` is set true by scrollNav once a drag/scroll begins.
  vp.addEventListener("pointerup", (e) => {
    if (e.pointerType !== "touch") return;
    if (dragging) { hideTip(); return; } // was a scroll, not a tap
    showTipAt(e.clientX, e.clientY);
  });
})();

// ---------- info boxes ----------
function drawMoon() {
  const m = moonPhase();
  $("moonBody").innerHTML = `
    <div class="moon-glyph">${m.glyph}</div>
    <div class="big">${m.name}</div>
    <div class="kv"><span class="k">Illumination</span><span>${(m.illumination * 100).toFixed(0)}%</span></div>
    <div class="kv"><span class="k">Moon age</span><span>${m.ageDays.toFixed(1)} d</span></div>
    <div class="kv"><span class="k">Next full</span><span>${m.nextFull.toFixed(1)} d</span></div>
    <div class="kv"><span class="k">Next new</span><span>${m.nextNew.toFixed(1)} d</span></div>`;
}

// Renders the Air box from OFFICIAL AirNow (via the proxy). Current AQI +
// per-pollutant observations + the daily forecast discussion. No chart series.
async function drawAir(lat, lon) {
  const body = $("airBody");
  const title = $("airTitle");
  body.innerHTML = `<span class="loading">Loading air quality…</span>`;
  try {
    const q = await airQuality(lat, lon);
    const link = `<a href="${q.link}" target="_blank" rel="noopener">Full details at AirNow.gov →</a>`;

    // No proxy configured -> explain how to enable official data.
    if (!q.configured) {
      if (title) title.textContent = "Air quality · AirNow";
      body.innerHTML =
        `<div class="loading">Official EPA AirNow data needs a tiny key-holding proxy
          (an API key can't be safely embedded in a public page).</div>
         <div class="note">Deploy the Cloudflare Worker in <code>airnow-proxy/</code> and set
          <code>AIRNOW_PROXY</code> in <code>js/airnow.js</code> — see
          <code>AIRNOW_SETUP.md</code>. ${link}</div>`;
      return;
    }

    if (title) title.textContent = "Air quality · AirNow (EPA)";
    // Feed the official current AQI into the top "Current" box.
    if (q.now?.AQI != null) { officialAqi = q.now.AQI; drawHero(); }
    // Headline: the max-AQI pollutant right now.
    let head = "";
    if (q.now) {
      const c = aqiCategory(q.now.AQI);
      const when = q.now.HourObserved != null
        ? ` <span class="k" style="font-weight:400">(as of ${fmtAirNowHour(q.now)})</span>` : "";
      head = `<div class="big">AQI <span class="aqi-pill" style="background:${c.color}">${q.now.AQI} ${q.now.Category?.Name || c.name}</span>${when}</div>`;
    }
    // Per-pollutant current readings.
    const rows = (q.observations || []).map((o) => {
      const c = aqiCategory(o.AQI);
      return `<div class="kv"><span class="k">${o.ParameterName}</span>
        <span><span class="aqi-pill" style="background:${c.color}">${o.AQI} ${o.Category?.Name || c.name}</span></span></div>`;
    }).join("");
    // Daily forecast (may be multiple days / pollutants; show the action day or first).
    const fc = (q.forecasts || []).find((f) => f.ActionDay) || q.forecasts?.[0];
    const fcHtml = fc
      ? `<div class="note"><b>Forecast ${fc.DateForecast?.trim()}</b> — ${fc.ParameterName} AQI ${fc.AQI >= 0 ? fc.AQI : "—"} (${fc.Category?.Name || ""})${fc.ActionDay ? " · <b>Action Day</b>" : ""}${collapsibleProse(fc.Discussion)}</div>`
      : "";
    body.innerHTML = (head + rows || `<div class="loading">No current readings for this area.</div>`) +
      fcHtml + `<div class="note">Source: EPA AirNow. ${link}</div>`;
  } catch (e) {
    if (title) title.textContent = "Air quality · AirNow";
    body.innerHTML = `<span class="err">Air quality unavailable (${e.message}).</span>`;
  }
}

// AirNow gives DateObserved + HourObserved (local to the reporting area, 0–23).
function fmtAirNowHour(o) {
  const h = o.HourObserved;
  if (h == null) return o.DateObserved?.trim() || "";
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12} ${ampm}`;
}

// AirNow forecast discussions can run several paragraphs. Show a short preview
// with a "show more"/"show less" toggle (handled by the delegated click below).
const PROSE_PREVIEW = 160; // chars before truncating at a word boundary
function collapsibleProse(text) {
  const s = (text || "").trim();
  if (!s) return "";
  if (s.length <= PROSE_PREVIEW) return `<br>${escapeHtml(s)}`;
  let cut = s.lastIndexOf(" ", PROSE_PREVIEW);
  if (cut < PROSE_PREVIEW * 0.6) cut = PROSE_PREVIEW; // avoid a too-short preview
  const preview = escapeHtml(s.slice(0, cut).trimEnd());
  const rest = escapeHtml(s.slice(cut).trimStart());
  return `<br><span class="prose">` +
    `<span class="prose-preview">${preview}… <button type="button" class="prose-toggle" data-prose="more">show more</button></span>` +
    `<span class="prose-full" hidden>${preview} ${rest} <button type="button" class="prose-toggle" data-prose="less">show less</button></span>` +
    `</span>`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
// Delegated toggle: swap preview <-> full within the same .prose block.
$("airBody").addEventListener("click", (e) => {
  const btn = e.target.closest(".prose-toggle");
  if (!btn) return;
  const prose = btn.closest(".prose");
  if (!prose) return;
  const showFull = btn.dataset.prose === "more";
  prose.querySelector(".prose-preview").hidden = showFull;
  prose.querySelector(".prose-full").hidden = !showFull;
});

async function drawAlerts(lat, lon) {
  const body = $("oemBody");
  body.innerHTML = `<span class="loading">Checking alerts…</span>`;
  try {
    const al = await noaa.alerts(lat, lon);
    if (!al.length) { body.innerHTML = `<div class="loading">No active watches, warnings, or advisories.</div>`; return; }
    body.innerHTML = al.map((a) => `
      <div class="kv"><span class="big">${a.event}</span><span>${a.severity || ""}</span></div>
      <div class="note">${a.headline || ""}${a.sender ? "<br>— " + a.sender : ""}</div>`).join("");
  } catch (e) {
    body.innerHTML = `<span class="err">Alerts unavailable (${e.message}).</span>`;
  }
}

// ---------- main load pipeline ----------
async function loadLocation(query) {
  const status = $("chartStatus");
  const locLabel = $("locLabel");
  selectedDay = new Date(); // a fresh location resets the summary to today
  officialAqi = null;        // clear stale AQI until AirNow responds
  try {
    locLabel.textContent = "Locating…";
    const loc = await geocode(query);
    locLabel.textContent = `${loc.label}  ·  ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
    setUrlQuery(query); // keep the location in the URL for stability across refresh

    status.textContent = "Fetching forecast & observations…";
    drawMoon();
    drawAlerts(loc.lat, loc.lon);
    drawAir(loc.lat, loc.lon); // official AirNow box; independent of the chart

    // Open-Meteo first (fast, always works) so the chart appears quickly.
    const omRecords = await openMeteo(loc.lat, loc.lon).catch(() => []);

    // NWS in parallel: forecast grid + observations. Degrade gracefully.
    let nwsForecast = [], observed = store.loadObservations(loc.lat, loc.lon);
    try {
      const pt = await noaa.points(loc.lat, loc.lon);
      if (pt.city) locLabel.textContent = `${loc.label}  ·  NWS ${pt.city}`;
      const [fc, obsRes] = await Promise.all([
        noaa.gridForecast(pt.forecastGrid).catch(() => []),
        noaa.observations(pt.stationsUrl).catch(() => ({ obs: [] })),
      ]);
      nwsForecast = fc;
      if (obsRes.obs?.length) {
        // persist measured values so the far-past window fills over time
        observed = store.mergeObservations(loc.lat, loc.lon, obsRes.obs);
      }
    } catch (e) {
      status.textContent = `NWS unavailable (${e.message}); showing Open-Meteo only.`;
    }

    currentRecords = mergeAll({ omRecords, nwsForecast, observed });
    if (!currentRecords.length) { status.textContent = "No data returned for this location."; return; }

    draw();
    drawHero();
    requestAnimationFrame(scrollToNow);
    const measuredN = currentRecords.filter((r) => r.measured).length;
    status.textContent = `${currentRecords.length} hourly points · ${measuredN} measured (cached) · forecast to +10 d.`;
  } catch (e) {
    locLabel.innerHTML = `<span class="err">${e.message}</span>`;
    status.textContent = "";
  }
}

// ---------- location <-> URL (?q=...) ----------
// The ZIP / airport / city query is the only persisted state. Keeping it in the
// URL means a refresh (or a shared/bookmarked link) reloads the same place.
function getUrlQuery() {
  return new URLSearchParams(location.search).get("q");
}
function setUrlQuery(q) {
  const url = new URL(location.href);
  if (url.searchParams.get("q") === q) return;
  url.searchParams.set("q", q);
  history.replaceState({ q }, "", url); // replace, so refresh is stable w/o stacking history
}

// ---------- wire up ----------
buildToggles();
$("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("query").value.trim();
  if (q) loadLocation(q);
});

// Back/forward: if the URL's q changes, reload that location.
addEventListener("popstate", () => {
  const q = getUrlQuery();
  if (q && q !== $("query").value.trim()) { $("query").value = q; loadLocation(q); }
});

// Initial location: URL param if present, else a sensible default.
const initial = getUrlQuery() || "10001";
$("query").value = initial;
loadLocation(initial);
