// App entry: state, comparison tabs, input wiring, and the render loop.

import { Mortgage } from "./mortgage.js";
import {
  clamp, fmtUSD0, fmtCompactUSD, fmtRate, parseNum,
  firstOfNextMonth, toMonthInput, fromMonthInput, addMonths, fmtMonthYear,
} from "./format.js";
import {
  RATE_DEFAULTS, MAX_LOANS, defaultLoan, defaultBounds, loanName,
  recomputeDerived, derivedField, markEdited, tryLiveRates,
} from "./loans.js";
import { drawChart, loanLineStyles } from "./chart.js";
import { encodeState, decodeState, writeHash } from "./share.js";

const $ = (id) => document.getElementById(id);

// fixed interest-rate slider bounds
const RATE_MIN = 1.5, RATE_MAX = 20;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  loans: [],
  activeIndex: 0,
  bounds: defaultBounds(),
};

function firstPayDate(loan) {
  return loan.firstPayISO ? fromMonthInput(loan.firstPayISO) : firstOfNextMonth();
}
function activeLoan() { return state.loans[state.activeIndex]; }

// reset state to a single default loan with default bounds
function loadDefaults() {
  const L = defaultLoan(0);
  L.firstPayISO = toMonthInput(firstOfNextMonth());
  state.loans = [L];
  state.activeIndex = 0;
  state.bounds = defaultBounds();
}

function initState() {
  const restored = decodeState(location.hash);
  if (restored) {
    state.loans = restored.loans;
    state.activeIndex = restored.activeIndex;
    state.bounds = restored.bounds;
    dirty = true; // a shared link stays shareable
  } else {
    loadDefaults();
  }
  // ensure firstPayISO always set
  state.loans.forEach((L) => { if (!L.firstPayISO) L.firstPayISO = toMonthInput(firstOfNextMonth()); });
}

// ---------------------------------------------------------------------------
// Comparison tabs
// ---------------------------------------------------------------------------
function renderTabs() {
  const host = $("tabs");
  let html = "";
  state.loans.forEach((L, i) => {
    const on = i === state.activeIndex ? " on" : "";
    const summary = state.loans.length > 1 ? loanSummary(L) : "";
    html +=
      `<div class="tab${on}" data-idx="${i}">` +
        `<div class="tab-row">` +
          `<input type="checkbox" class="tab-vis" data-idx="${i}" ${L.visible ? "checked" : ""} title="Show on chart" aria-label="Show ${L.name} on chart">` +
          `<button type="button" class="tab-sel" data-idx="${i}">${L.name}</button>` +
          (state.loans.length > 1 ? `<button type="button" class="tab-x" data-idx="${i}" title="Remove ${L.name}" aria-label="Remove ${L.name}">✕</button>` : "") +
        `</div>` +
        summary +
      `</div>`;
  });
  if (state.loans.length < MAX_LOANS) {
    html += `<button type="button" class="tab-add" id="tab-add">+ Add loan</button>`;
  }
  host.innerHTML = html;

  host.querySelectorAll(".tab-sel").forEach((b) =>
    b.addEventListener("click", () => { markDirty(); state.activeIndex = +b.dataset.idx; render(); }));
  host.querySelectorAll(".tab-vis").forEach((c) =>
    c.addEventListener("change", () => { state.loans[+c.dataset.idx].visible = c.checked; render(); }));
  host.querySelectorAll(".tab-x").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); removeLoan(+b.dataset.idx); }));
  const add = $("tab-add");
  if (add) add.addEventListener("click", addLoan);
}

// compact per-loan summary shown under each tab when comparing (>1 loan):
// loan amount in $k, monthly payment, and payoff date (honors extra payments).
function loanSummary(L) {
  const m = new Mortgage({ loanAmount: L.loan, interestApr: L.rate, lengthYears: L.term });
  const sched = extraSchedule(L);
  const payoffMonths = m.totalMonthsToPayOff(sched);
  const payoffDate = addMonths(firstPayDate(L), Math.max(0, payoffMonths - 1));
  const amtK = "$" + Math.round(L.loan / 1000).toLocaleString("en-US") + "k";
  const pay = isFinite(m.baseMonthlyPayment) ? fmtUSD0(m.baseMonthlyPayment) + "/mo" : "—";
  return `<div class="tab-summary">` +
    `<span>${amtK}</span><span>${pay}</span><span>${fmtMonthYear(payoffDate)}</span>` +
  `</div>`;
}

function addLoan() {
  if (state.loans.length >= MAX_LOANS) return;
  markDirty();
  const src = activeLoan();
  const L = JSON.parse(JSON.stringify(src)); // clone active loan as a starting point
  L.name = loanName(state.loans.length);
  L.visible = true;
  state.loans.push(L);
  state.activeIndex = state.loans.length - 1;
  render();
}

function removeLoan(i) {
  if (state.loans.length <= 1) return;
  markDirty();
  state.loans.splice(i, 1);
  state.loans.forEach((L, j) => { L.name = loanName(j); });
  if (state.activeIndex >= state.loans.length) state.activeIndex = state.loans.length - 1;
  render();
}

// ---------------------------------------------------------------------------
// Field sync
// ---------------------------------------------------------------------------
function syncBasicField(key, val, isDerived) {
  const input = $(key);
  const row = $("row-" + key);
  const field = $("field-" + key);
  const slider = $(key + "-slider");
  const hint = $(key + "-hint");

  if (document.activeElement !== input) {
    if (key === "dp") input.value = (val * 100).toFixed(2).replace(/\.?0+$/, "");
    else input.value = Math.round(val).toLocaleString("en-US");
  }

  row.classList.toggle("derived", isDerived);
  field.classList.toggle("derived", isDerived);
  input.readOnly = isDerived;
  if (hint) hint.textContent = isDerived ? "computed" : "";

  if (key === "dp") {
    if (document.activeElement !== slider) slider.value = clamp(val * 100, 0, 50);
  } else {
    const min = key === "price" ? state.bounds.priceMin : state.bounds.loanMin;
    const max = key === "price" ? state.bounds.priceMax : state.bounds.loanMax;
    // fixed, editable bounds — never derived from the value
    slider.min = min;
    slider.max = max;
    slider.step = Math.max(1, Math.round((max - min) / 1000));
    if (document.activeElement !== slider) slider.value = clamp(val, min, max);
    const minInp = $(key + "-min"), maxInp = $(key + "-max");
    if (document.activeElement !== minInp) minInp.value = Math.round(min).toLocaleString("en-US");
    if (document.activeElement !== maxInp) maxInp.value = Math.round(max).toLocaleString("en-US");
  }
}

function syncRateField(loan) {
  const input = $("rate"), slider = $("rate-slider");
  if (document.activeElement !== input) input.value = fmtRate(loan.rate);
  // fixed bounds — never derived from the current value (that re-centers the thumb)
  const min = RATE_MIN, max = RATE_MAX;
  slider.min = min; slider.max = max; slider.step = 0.05;
  if (document.activeElement !== slider) slider.value = clamp(loan.rate, min, max);
  $("rate-min").textContent = min.toFixed(1) + "%";
  $("rate-max").textContent = max.toFixed(0) + "%";

  const d = RATE_DEFAULTS;
  const liveTxt = d.live
    ? "Live weekly average fetched from FRED"
    : "Default is the latest weekly average we have on file";
  $("rate-note").innerHTML =
    liveTxt + " for a " + loan.term + "-yr fixed loan" +
    (loan.term === 10 ? " (10-yr derived from the 15-yr average — no official 10-yr series exists)" : "") +
    ": <code>" + d[loan.term].toFixed(2) + "%</code> as of " + d.asOf +
    '. Source: <a href="https://fred.stlouisfed.org/series/' +
    (loan.term === 30 ? "MORTGAGE30US" : "MORTGAGE15US") +
    '" target="_blank" rel="noopener">' + d.source + "</a>. Editable — this is only a starting point.";
}

// ---------------------------------------------------------------------------
// Extra-payment schedule (array honoring "starting at month N")
// ---------------------------------------------------------------------------
function extraSchedule(loan) {
  const totalM = loan.term * 12;
  if (loan.extra <= 0) return 0;
  const arr = new Array(totalM + 1).fill(0);
  for (let i = 0; i <= totalM; i++) if (i >= loan.extraStart) arr[i] = loan.extra;
  return arr;
}

function extraPaidThrough(sched, upto) {
  if (sched === 0) return 0;
  let s = 0;
  for (let i = 0; i <= upto && i < sched.length; i++) s += sched[i];
  return s;
}

// clip balances to payoff month, floored at 0 for display
function clipSeries(arr, payoff) {
  return arr.slice(0, Math.min(arr.length, payoff + 1)).map((v) => Math.max(0, v));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  const loan = activeLoan();
  const dKey = recomputeDerived(loan);

  renderTabs();

  // basics
  syncBasicField("price", loan.price, dKey === "price");
  syncBasicField("loan", loan.loan, dKey === "loan");
  syncBasicField("dp", loan.dp, dKey === "dp");
  syncRateField(loan);

  // term
  document.querySelectorAll("#term-seg button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.term) === loan.term));

  const fp = firstPayDate(loan);
  if (document.activeElement !== $("firstpay")) $("firstpay").value = loan.firstPayISO;
  if (document.activeElement !== $("extra")) $("extra").value = Math.round(loan.extra).toLocaleString("en-US");
  if (document.activeElement !== $("extra-start")) $("extra-start").value = loan.extraStart;

  // math for active loan
  const m = new Mortgage({ loanAmount: loan.loan, interestApr: loan.rate, lengthYears: loan.term });
  const base = m.baseMonthlyPayment;
  $("payment").textContent = isFinite(base) ? fmtUSD0(base) : "—";
  $("loanline").textContent =
    "on a " + fmtUSD0(loan.loan) + " loan · " + loan.term + " yr · " + fmtRate(loan.rate) + "% APR";

  const sched = extraSchedule(loan);
  const payoffMonths = m.totalMonthsToPayOff(sched);
  const basePayoffMonths = m.totalMonthsToPayOff(0);

  const totalPaid = base * payoffMonths + extraPaidThrough(sched, payoffMonths);
  const totalInterest = totalPaid - loan.loan;
  $("total-paid").textContent = fmtUSD0(totalPaid);
  $("total-interest").textContent = fmtUSD0(Math.max(0, totalInterest));

  const payoffDate = addMonths(fp, Math.max(0, payoffMonths - 1));
  $("payoff-date").textContent = fmtMonthYear(payoffDate);

  const savedMonths = basePayoffMonths - payoffMonths;
  const savedEl = $("payoff-saved");
  if (loan.extra > 0 && savedMonths > 0) {
    const y = Math.floor(savedMonths / 12), mo = savedMonths % 12;
    const parts = [];
    if (y) parts.push(y + (y === 1 ? " yr" : " yrs"));
    if (mo) parts.push(mo + (mo === 1 ? " mo" : " mos"));
    const baseInterest = base * basePayoffMonths - loan.loan;
    const intSaved = Math.max(0, baseInterest - totalInterest);
    savedEl.innerHTML = "Paid off <b>" + parts.join(" ") + "</b> early · saves <b>" + fmtUSD0(intSaved) + "</b> interest";
  } else {
    savedEl.textContent = "";
  }

  // chart series for every loan
  const series = state.loans.map((L, i) => {
    const mm = new Mortgage({ loanAmount: L.loan, interestApr: L.rate, lengthYears: L.term });
    const sc = extraSchedule(L);
    const po = mm.totalMonthsToPayOff(sc);
    const basePo = mm.totalMonthsToPayOff(0);
    return {
      name: L.name,
      balances: clipSeries(mm.balanceRemainingPerMonth(sc), po),
      baseBalances: clipSeries(mm.balanceRemainingPerMonth(0), basePo),
      payoffMonth: po,
      active: i === state.activeIndex,
      visible: L.visible,
      hasExtra: L.extra > 0,
    };
  });
  drawChart($("chart-host"), $("tip"), $("legend"), series, { firstPay: fp });

  renderChartSummary(series);

  // shareable hash
  scheduleHashUpdate();
}

// summary table under the chart legend: one row per loan showing its line-style
// key, name, and all inputs/outputs. Shown only when comparing >1 loan.
function renderChartSummary(series) {
  const host = $("chart-summary");
  if (state.loans.length <= 1) { host.innerHTML = ""; return; }

  const styles = loanLineStyles(series); // keyed by loan name; visible loans only
  let rows = "";
  state.loans.forEach((L, i) => {
    const m = new Mortgage({ loanAmount: L.loan, interestApr: L.rate, lengthYears: L.term });
    const payoffMonths = m.totalMonthsToPayOff(extraSchedule(L));
    const payoffDate = addMonths(firstPayDate(L), Math.max(0, payoffMonths - 1));
    const amtK = "$" + Math.round(L.loan / 1000).toLocaleString("en-US") + "k";
    const price = fmtUSD0(L.price);
    const dpPct = (L.dp * 100).toFixed(1).replace(/\.0$/, "") + "%";
    const rate = fmtRate(L.rate) + "%";
    const extra = L.extra > 0 ? fmtUSD0(L.extra) + "/mo" : "—";
    const pay = isFinite(m.baseMonthlyPayment) ? fmtUSD0(m.baseMonthlyPayment) + "/mo" : "—";

    const st = styles[L.name];
    const key = st
      ? `<span class="csum-key" style="border-top-color:${st.color};${st.dash ? "border-top-style:dashed;" : ""}"></span>`
      : `<span class="csum-key off"></span>`;

    const cls = "csum-row" + (i === state.activeIndex ? " active" : "") + (L.visible ? "" : " off");
    rows +=
      `<tr class="${cls}">` +
        `<td class="csum-name"><span class="csum-keywrap">${key}</span>${L.name}${L.visible ? "" : " <span class=\"csum-hidden\">(hidden)</span>"}</td>` +
        `<td>${price}</td><td>${dpPct}</td><td>${amtK}</td>` +
        `<td>${rate}</td><td>${extra}</td><td>${pay}</td><td>${fmtMonthYear(payoffDate)}</td>` +
      `</tr>`;
  });
  host.innerHTML =
    `<div class="csum-scroll"><table class="csum"><thead><tr>` +
      `<th>Loan</th><th>Sale price</th><th>Down</th><th>Amount</th>` +
      `<th>Rate</th><th>Extra</th><th>Payment</th><th>Payoff</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Track whether the user has touched anything. A pristine single-default loan
// leaves the URL bare (reset restores this); any real interaction starts
// encoding state into the hash so it stays shareable.
let dirty = false;
function markDirty() { dirty = true; }

// debounce hash writes
let hashTimer = null;
function scheduleHashUpdate() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    if (dirty) {
      writeHash(encodeState(state.loans, state.activeIndex, state.bounds));
    } else {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, 250);
}

// ---------------------------------------------------------------------------
// Input wiring
// ---------------------------------------------------------------------------
function setBasicFromInput(key, raw) {
  const loan = activeLoan();
  const v = parseNum(raw);
  if (!isFinite(v)) return;
  if (key === "dp") loan.dp = clamp(v / 100, 0, 0.99);
  else loan[key] = Math.max(0, v);
  markEdited(loan, key); // editing a field makes it freshest -> a different field derives
}

function wire() {
  // any field edit (input/change on a form control) makes the state shareable
  document.addEventListener("input", markDirty);
  document.addEventListener("change", markDirty);

  ["price", "loan", "dp"].forEach((key) => {
    $(key).addEventListener("input", (e) => { setBasicFromInput(key, e.target.value); render(); });
    $(key).addEventListener("blur", render);
    $(key + "-slider").addEventListener("input", (e) => {
      const loan = activeLoan();
      const v = parseFloat(e.target.value);
      if (key === "dp") loan.dp = clamp(v / 100, 0, 0.99);
      else loan[key] = v;
      markEdited(loan, key);
      render();
    });
  });

  // editable slider bounds
  const bindBound = (id, prop) => {
    $(id).addEventListener("input", (e) => {
      const v = parseNum(e.target.value);
      if (isFinite(v) && v >= 0) { state.bounds[prop] = v; render(); }
    });
    $(id).addEventListener("blur", render);
  };
  bindBound("price-min", "priceMin"); bindBound("price-max", "priceMax");
  bindBound("loan-min", "loanMin"); bindBound("loan-max", "loanMax");

  // term
  document.querySelectorAll("#term-seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const loan = activeLoan();
      loan.term = Number(btn.dataset.term);
      if (!loan.rateEdited) loan.rate = RATE_DEFAULTS[loan.term];
      render();
    });
  });

  // rate
  $("rate").addEventListener("input", (e) => {
    const loan = activeLoan(); const v = parseNum(e.target.value);
    if (isFinite(v)) { loan.rate = clamp(v, 0, 25); loan.rateEdited = true; }
    render();
  });
  $("rate").addEventListener("blur", render);
  $("rate-slider").addEventListener("input", (e) => {
    const loan = activeLoan();
    loan.rate = clamp(parseFloat(e.target.value), RATE_MIN, RATE_MAX); loan.rateEdited = true; render();
  });

  // extra payments
  $("extra").addEventListener("input", (e) => {
    const loan = activeLoan(); const v = parseNum(e.target.value);
    loan.extra = isFinite(v) ? Math.max(0, v) : 0; render();
  });
  $("extra").addEventListener("blur", render);
  $("extra-start").addEventListener("input", (e) => {
    const loan = activeLoan(); const v = parseInt(e.target.value, 10);
    loan.extraStart = isFinite(v) ? clamp(v, 0, loan.term * 12) : 0; render();
  });
  $("firstpay").addEventListener("input", (e) => {
    if (e.target.value) { activeLoan().firstPayISO = e.target.value; render(); }
  });

  // theme toggle
  $("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.getAttribute("data-theme");
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = cur ? (cur === "dark" ? "light" : "dark") : (sysDark ? "light" : "dark");
    root.setAttribute("data-theme", next);
    render();
  });

  // reset to defaults (also clears the shared-comparison hash)
  $("reset").addEventListener("click", () => {
    loadDefaults();
    dirty = false;
    history.replaceState(null, "", location.pathname + location.search);
    render();
  });

  // copy shareable link
  $("copylink").addEventListener("click", async () => {
    writeHash(encodeState(state.loans, state.activeIndex, state.bounds));
    const btn = $("copylink");
    try {
      await navigator.clipboard.writeText(location.href);
      flash(btn, "Copied!");
    } catch (_) {
      // clipboard may be blocked; select-free fallback message
      flash(btn, "Copy from address bar");
    }
  });
}

function flash(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = old; }, 1400);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
initState();
wire();
render();
tryLiveRates().then((updated) => {
  if (!updated) return;
  state.loans.forEach((L) => { if (!L.rateEdited) L.rate = RATE_DEFAULTS[L.term]; });
  render();
});

// expose a little state for headless verification/debugging (no effect on UX)
window.__mortgageApp = { state, RATE_DEFAULTS };
