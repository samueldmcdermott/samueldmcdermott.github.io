// Formatting + small date helpers, shared across modules.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const fmtUSD0 = (n) => "$" + Math.round(n).toLocaleString("en-US");

export function fmtCompactUSD(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return "$" + Math.round(n / 1e3) + "K";
  return "$" + Math.round(n);
}

// trim trailing zeros from a fixed-precision rate string, e.g. 6.490 -> "6.49"
export function fmtRate(n) {
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function parseNum(str) {
  if (str == null) return NaN;
  return parseFloat(String(str).replace(/[^0-9.\-]/g, ""));
}

export function firstOfNextMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function toMonthInput(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function fromMonthInput(str) {
  const [y, m] = str.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function fmtMonthYear(d) {
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
