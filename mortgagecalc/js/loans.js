// Loan model: creation, defaults, least-recently-edited (LRE) derivation,
// interest-rate defaults + best-effort live refresh, and slider bounds.

import { clamp } from "./format.js";

export const MAX_LOANS = 4;

// Freddie Mac PMMS weekly averages (baked-in fallback; see rate note).
// 30/15 are official PMMS; 10yr has no official PMMS series -> derived from 15yr.
export const RATE_DEFAULTS = {
  30: 6.49, 15: 5.82, 10: 5.62,
  asOf: "2026-07-09", source: "Freddie Mac PMMS via FRED",
  live: false,
};

// Fixed, editable slider bounds (NOT auto-rescaled from the value).
export function defaultBounds() {
  return { priceMin: 50000, priceMax: 2000000, loanMin: 50000, loanMax: 2000000 };
}

let editCounter = 0;
export function nextEditStamp() { return ++editCounter; }

const LOAN_NAMES = ["Loan A", "Loan B", "Loan C", "Loan D"];
export function loanName(i) { return LOAN_NAMES[i] || "Loan " + (i + 1); }

// A fresh loan. price/dp are the "seeded" fields; loan is derived from them,
// so `edited.loan` is the oldest and stays the computed field until touched.
export function defaultLoan(index = 0) {
  const term = 30;
  return {
    price: 500000,
    loan: 400000,          // 500k * (1 - 0.20)
    dp: 0.20,              // fraction
    edited: { price: nextEditStamp(), dp: nextEditStamp(), loan: 0 }, // loan oldest -> derived
    term,
    rate: RATE_DEFAULTS[term],
    rateEdited: false,
    extra: 0,
    extraStart: 0,
    firstPayISO: null,     // set by main from firstOfNextMonth(); ISO "YYYY-MM"
    visible: true,
    name: loanName(index),
  };
}

// Which of {price, loan, dp} is derived = the field edited furthest in the past.
export function derivedField(loan) {
  const e = loan.edited;
  let key = "loan", min = Infinity;
  for (const k of ["price", "loan", "dp"]) {
    if (e[k] < min) { min = e[k]; key = k; }
  }
  return key;
}

// Recompute the derived field from the other two, keeping the relation
// loan = price * (1 - dp) consistent.
export function recomputeDerived(loan) {
  const d = derivedField(loan);
  if (d === "loan") {
    loan.loan = loan.price * (1 - loan.dp);
  } else if (d === "price") {
    loan.price = loan.dp < 1 ? loan.loan / (1 - loan.dp) : loan.loan;
  } else { // dp
    loan.dp = loan.price > 0 ? clamp(1 - loan.loan / loan.price, 0, 0.9999) : 0;
  }
  return d;
}

// Mark a field as just-edited so it stops being the derived one.
export function markEdited(loan, key) {
  loan.edited[key] = nextEditStamp();
}

// Best-effort live rate refresh (progressive enhancement).
// FRED CSV has no CORS header, so this normally fails silently and we keep the
// baked-in defaults. Returns true if it updated RATE_DEFAULTS.
export async function tryLiveRates() {
  const series = { 30: "MORTGAGE30US", 15: "MORTGAGE15US" };
  const fetchOne = async (id) => {
    const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=" + id;
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("bad");
    const txt = await res.text();
    const lines = txt.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i > 0; i--) {
      const [date, val] = lines[i].split(",");
      const num = parseFloat(val);
      if (isFinite(num)) return { rate: num, date };
    }
    throw new Error("no data");
  };
  try {
    const [r30, r15] = await Promise.all([fetchOne(series[30]), fetchOne(series[15])]);
    RATE_DEFAULTS[30] = r30.rate;
    RATE_DEFAULTS[15] = r15.rate;
    RATE_DEFAULTS[10] = Math.max(0, r15.rate - 0.20); // derived
    RATE_DEFAULTS.asOf = r30.date;
    RATE_DEFAULTS.live = true;
    return true;
  } catch (_) {
    return false; // keep baked-in defaults, silent
  }
}
