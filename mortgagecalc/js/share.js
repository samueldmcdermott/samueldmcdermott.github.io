// Shareable comparison state <-> URL hash. No cookies, no storage APIs —
// the URL hash is the only persistence, so a link *is* the saved comparison.

import { defaultLoan, loanName, nextEditStamp } from "./loans.js";

const VERSION = 1;

// Encode to a compact positional form, then base64 in the hash.
// Per loan: [price, loan, dp, term, rate, rateEdited, extra, extraStart,
//            firstPayISO, visible, derivedKey]
const DKEY = { price: 0, loan: 1, dp: 2 };
const DKEY_INV = ["price", "loan", "dp"];

export function encodeState(loans, activeIndex, bounds) {
  const payload = {
    v: VERSION,
    a: activeIndex,
    b: [bounds.priceMin, bounds.priceMax, bounds.loanMin, bounds.loanMax],
    l: loans.map((L) => [
      round(L.price), round(L.loan), +L.dp.toFixed(6), L.term, +L.rate.toFixed(4),
      L.rateEdited ? 1 : 0, round(L.extra), L.extraStart | 0,
      L.firstPayISO || "", L.visible ? 1 : 0, DKEY[derivedOf(L)],
    ]),
  };
  try {
    return "#c=" + b64encode(JSON.stringify(payload));
  } catch (_) {
    return "";
  }
}

export function decodeState(hash) {
  if (!hash || hash.indexOf("c=") < 0) return null;
  try {
    const raw = hash.slice(hash.indexOf("c=") + 2);
    const payload = JSON.parse(b64decode(raw));
    if (!payload || payload.v !== VERSION || !Array.isArray(payload.l) || !payload.l.length) return null;

    const bounds = {
      priceMin: payload.b[0], priceMax: payload.b[1],
      loanMin: payload.b[2], loanMax: payload.b[3],
    };
    const loans = payload.l.map((t, i) => {
      const L = defaultLoan(i);
      L.price = num(t[0], L.price);
      L.loan = num(t[1], L.loan);
      L.dp = num(t[2], L.dp);
      L.term = [10, 15, 30].includes(t[3]) ? t[3] : 30;
      L.rate = num(t[4], L.rate);
      L.rateEdited = !!t[5];
      L.extra = num(t[6], 0);
      L.extraStart = (t[7] | 0);
      L.firstPayISO = typeof t[8] === "string" && t[8] ? t[8] : L.firstPayISO;
      L.visible = t[9] === undefined ? true : !!t[9];
      // rebuild edit stamps so the encoded derived field stays derived (oldest)
      const dk = DKEY_INV[t[10]] || "loan";
      L.edited = stampsWithOldest(dk);
      L.name = loanName(i);
      return L;
    });
    const activeIndex = Math.min(Math.max(0, payload.a | 0), loans.length - 1);
    return { loans, activeIndex, bounds };
  } catch (_) {
    return null;
  }
}

// write hash without a scroll jump / history spam
export function writeHash(hashStr) {
  if (!hashStr) return;
  history.replaceState(null, "", hashStr);
}

// ---- helpers ----
function round(n) { return Math.round(n); }
function num(v, fallback) { const x = Number(v); return isFinite(x) ? x : fallback; }

function derivedOf(L) {
  let key = "loan", min = Infinity;
  for (const k of ["price", "loan", "dp"]) {
    if (L.edited[k] < min) { min = L.edited[k]; key = k; }
  }
  return key;
}

// build fresh edit stamps where `oldestKey` is the smallest (=> derived)
function stampsWithOldest(oldestKey) {
  const e = { price: 0, loan: 0, dp: 0 };
  e[oldestKey] = 0;
  for (const k of ["price", "loan", "dp"]) {
    if (k !== oldestKey) e[k] = nextEditStamp();
  }
  return e;
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(s)));
}
