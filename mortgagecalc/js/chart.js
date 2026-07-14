// Amortization chart — hand-rolled SVG, self-contained (no libraries).
// Draws one or more loan balance curves overlaid. The active loan is drawn in
// the accent hue; other loans use grayscale lightness steps + dash patterns so
// identity never relies on color alone (legend + direct end-dots reinforce it).

import { fmtCompactUSD, fmtUSD0, fmtMonthYear, addMonths } from "./format.js";

const CH = { w: 720, h: 340, l: 58, r: 78, t: 14, b: 34 };

// dash patterns for non-active loans (solid handled separately for the active one)
const DASH = ["", "6 5", "2 4", "8 4 2 4"];
// grayscale steps for non-active loans (resolved via CSS vars set on :root)
const GRAYS = ["var(--s-1)", "var(--s-2)", "var(--s-3)", "var(--s-4)"];

// The single source of truth for how each loan's curve is styled. Active loan =
// accent solid; others cycle grayscale + dash in visible order. Returns a map
// keyed by loan name -> { color, dash } so the chart and the summary table agree.
export function loanLineStyles(series) {
  const vis = series.filter((s) => s.visible);
  const ordered = [...vis].sort((a, b) => (a.active === b.active ? 0 : a.active ? 1 : -1));
  const styles = {};
  let grayIdx = 0;
  ordered.forEach((s) => {
    if (s.active) {
      styles[s.name] = { color: "var(--accent-line)", dash: "" };
    } else {
      styles[s.name] = { color: GRAYS[grayIdx % GRAYS.length], dash: DASH[grayIdx % DASH.length] };
      grayIdx++;
    }
  });
  return styles;
}

let chartData = null; // stashed for hover

// series: [{ name, balances:[...], payoffMonth, active, visible, hasExtra, baseBalances? }]
// opts: { firstPay }
export function drawChart(host, tipEl, legendEl, series, opts) {
  const vis = series.filter((s) => s.visible);
  const { w, h, l, r, t, b } = CH;

  // scales span every visible loan
  let yMax = 1, xMaxMonths = 12;
  vis.forEach((s) => {
    yMax = Math.max(yMax, s.balances[0] || 0);
    xMaxMonths = Math.max(xMaxMonths, s.balances.length - 1);
  });
  // round xMax up to whole years for tidy axis
  const xMaxYears = Math.max(1, Math.ceil(xMaxMonths / 12));
  const xMax = xMaxYears * 12;

  const px = (m) => l + (m / xMax) * (w - l - r);
  const py = (v) => t + (1 - v / yMax) * (h - t - b);

  const pathOf = (arr) => {
    let d = "";
    for (let i = 0; i < arr.length; i++) {
      d += (i === 0 ? "M" : "L") + px(i).toFixed(2) + " " + py(Math.max(0, arr[i])).toFixed(2) + " ";
    }
    return d.trim();
  };

  // gridlines
  const yTicks = niceTicks(yMax, 5);
  let grid = "";
  yTicks.forEach((v) => {
    grid += `<line class="gl" x1="${l}" y1="${py(v)}" x2="${w - r}" y2="${py(v)}"/>`;
  });
  const yearStep = xMaxYears <= 10 ? (xMaxYears <= 6 ? 1 : 2) : (xMaxYears <= 15 ? 3 : 5);
  let xlabels = "";
  for (let yr = 0; yr <= xMaxYears; yr += yearStep) {
    const mx = px(yr * 12);
    xlabels += `<line class="gl" x1="${mx}" y1="${t}" x2="${mx}" y2="${h - b}"/>`;
    xlabels += `<text class="axis-text" x="${mx}" y="${h - b + 16}" text-anchor="middle">${yr}y</text>`;
  }
  let ylabels = "";
  yTicks.forEach((v) => {
    ylabels += `<text class="axis-text" x="${l - 8}" y="${py(v) + 3.5}" text-anchor="end">${fmtCompactUSD(v)}</text>`;
  });

  // draw order: non-active first, active last (on top). track styling for legend/hover.
  const drawn = [];
  const styleOf = loanLineStyles(vis);
  const ordered = [...vis].sort((a, b2) => (a.active === b2.active ? 0 : a.active ? 1 : -1));
  let paths = "", ends = "";
  const endPt = (arr, color) => {
    const i = arr.length - 1;
    return `<circle cx="${px(i)}" cy="${py(Math.max(0, arr[i]))}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
  };

  ordered.forEach((s) => {
    const { color, dash } = styleOf[s.name];
    // companion "no extra" baseline, only for the active loan with extra payments
    if (s.active && s.hasExtra && s.baseBalances) {
      paths += `<path class="series" d="${pathOf(s.baseBalances)}" stroke="var(--s-4)" stroke-dasharray="5 5"/>`;
      ends += endPt(s.baseBalances, "var(--s-4)");
    }
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
    paths += `<path class="series" d="${pathOf(s.balances)}" stroke="${color}"${dashAttr}/>`;
    ends += endPt(s.balances, color);
    drawn.push({ name: s.name, color, dash, active: s.active, hasExtra: s.hasExtra });
  });

  host.innerHTML =
`<svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="xMidYMid meet" aria-label="Loan balance remaining over time">
  ${grid}${xlabels}
  <line class="axis-line" x1="${l}" y1="${h - b}" x2="${w - r}" y2="${h - b}"/>
  <line class="axis-line" x1="${l}" y1="${t}" x2="${l}" y2="${h - b}"/>
  ${ylabels}
  ${paths}
  ${ends}
  <rect id="hit" x="${l}" y="${t}" width="${w - l - r}" height="${h - t - b}" fill="transparent"/>
  <line id="hoverline" class="hoverline" x1="0" y1="${t}" x2="0" y2="${h - b}" style="opacity:0"/>
</svg>`;

  // legend
  if (vis.length > 1 || (vis[0] && vis[0].hasExtra)) {
    let items = drawn.map((d) => {
      const style = `border-top-color:${d.color};` + (d.dash ? "border-top-style:dashed;" : "");
      return `<span class="item"><span class="key" style="${style}"></span>${escapeHtml(d.name)}</span>`;
    });
    if (vis.length === 1 && vis[0].hasExtra) {
      items.push(`<span class="item"><span class="key" style="border-top-color:var(--s-4);border-top-style:dashed"></span>No extra</span>`);
    }
    legendEl.innerHTML = items.join("");
  } else if (vis[0]) {
    legendEl.innerHTML = `<span class="item"><span class="key" style="border-top-color:var(--accent-line)"></span>Balance remaining</span>`;
  } else {
    legendEl.innerHTML = "";
  }

  chartData = { vis, px, py, xMax, yMax, l, r, t, b, w, h, firstPay: opts.firstPay };
  attachHover(host, tipEl);
}

function niceTicks(max, count) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step;
  if (norm < 1.5) step = 1; else if (norm < 3) step = 2; else if (norm < 7) step = 5; else step = 10;
  step *= mag;
  const ticks = [];
  for (let v = 0; v <= max + 1e-6; v += step) ticks.push(v);
  return ticks;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function attachHover(host, tip) {
  const svg = host.querySelector("svg");
  const hit = host.querySelector("#hit");
  const line = host.querySelector("#hoverline");
  if (!svg || !hit) return;

  const move = (evt) => {
    const cd = chartData; if (!cd) return;
    const pt = svg.createSVGPoint();
    const src = evt.touches ? evt.touches[0] : evt;
    pt.x = src.clientX; pt.y = src.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const frac = Math.min(1, Math.max(0, (loc.x - cd.l) / (cd.w - cd.l - cd.r)));
    const month = Math.round(frac * cd.xMax);

    const bx = cd.px(month);
    line.setAttribute("x1", bx); line.setAttribute("x2", bx);
    line.style.opacity = 1;

    let topVal = 0;
    const rows = cd.vis.map((s) => {
      const idx = Math.min(month, s.balances.length - 1);
      const val = Math.max(0, s.balances[idx]);
      topVal = Math.max(topVal, val);
      const nm = cd.vis.length > 1 ? escapeHtml(s.name) : "Balance";
      return `<div class="tt-row"><span>${nm}</span><b>${fmtUSD0(val)}</b></div>`;
    }).join("");
    const when = fmtMonthYear(addMonths(cd.firstPay, Math.max(0, month - 1)));
    tip.innerHTML = `<div class="tt-when">Month ${month} · ${when}</div>${rows}`;

    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / cd.w, scaleY = rect.height / cd.h;
    const hostRect = host.parentElement.getBoundingClientRect();
    const relLeft = rect.left - hostRect.left + bx * scaleX;
    const relTop = rect.top - hostRect.top + cd.py(topVal) * scaleY;
    tip.style.left = relLeft + "px";
    tip.style.top = relTop + "px";
    tip.style.opacity = 1;
  };
  const leave = () => {
    tip.style.opacity = 0;
    const l = host.querySelector("#hoverline"); if (l) l.style.opacity = 0;
  };

  hit.addEventListener("mousemove", move);
  hit.addEventListener("mouseleave", leave);
  hit.addEventListener("touchstart", move, { passive: true });
  hit.addEventListener("touchmove", move, { passive: true });
  hit.addEventListener("touchend", leave);
}
