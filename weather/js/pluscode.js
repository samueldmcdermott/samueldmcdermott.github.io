// Google Plus Code (Open Location Code) encoder.
//
// Pure lat/lon -> code math: no API, no key, CORS-clean, so it fits the static
// site. Produces a FULL code like "87F6WQ6H+2C" (8 chars + "+" + 2 chars =
// the standard ~14x14 m precision). The "4 + 2" short form (e.g. "WQ6H+2C")
// is only unambiguous when paired with a nearby locality name, which we can't
// derive here reliably, so we emit the full, self-contained code.
//
// Ported verbatim from the reference implementation's encodePairs():
// https://github.com/google/open-location-code — a shrinking 20x20 grid using a
// TABULATED place value per pair (PAIR_RES below). The tabulated values matter:
// dividing an accumulator by 20 each step instead drifts enough to flip a digit
// for coordinates that sit exactly on a cell boundary (e.g. 20.375). Verified
// against the official `open-location-code` npm package across boundary cases.

const ALPHABET = "23456789CFGHJMPQRVWX"; // 20 chars, base-20 digits
const SEP = "+";
const SEP_POS = 8;   // separator goes after 8 digits
const CODE_LEN = 10; // full precision (8 before "+", 2 after)
const LAT_MAX = 90;
const LON_MAX = 180;
// Degrees spanned by each successive pair of digits. Exact literals (not 20/20^n
// computed at runtime) so boundary coordinates round the same way as the spec.
const PAIR_RES = [20.0, 1.0, 0.05, 0.0025, 0.000125];

function clipLat(lat) { return Math.min(Math.max(lat, -LAT_MAX), LAT_MAX); }
function normLon(lon) {
  while (lon < -LON_MAX) lon += 360;
  while (lon >= LON_MAX) lon -= 360;
  return lon;
}
// Latitude exactly 90 lands in a cell that has no north neighbour to decode
// into; the reference nudges it down by one finest cell before encoding.
const FINEST = PAIR_RES[PAIR_RES.length - 1];

// Encode a coordinate to a full 10-digit Plus Code ("XXXXXXXX+XX").
export function encodePlusCode(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let latVal = clipLat(lat);
  if (latVal === LAT_MAX) latVal -= FINEST; // keep the north edge decodable
  let adjLat = latVal + LAT_MAX;         // into [0, 180)
  let adjLon = normLon(lon) + LON_MAX;   // into [0, 360)

  let code = "";
  let n = 0;
  while (n < CODE_LEN) {
    const place = PAIR_RES[Math.floor(n / 2)];
    // Latitude digit, then longitude digit, subtracting each from the running
    // value so the next (finer) place picks up the remainder.
    let d = Math.floor(adjLat / place);
    adjLat -= d * place;
    code += ALPHABET.charAt(d);
    n += 1;

    d = Math.floor(adjLon / place);
    adjLon -= d * place;
    code += ALPHABET.charAt(d);
    n += 1;

    if (n === SEP_POS && n < CODE_LEN) code += SEP;
  }
  if (code.length === SEP_POS) code += SEP;
  return code;
}

// ---- Decoding / validation (for accepting a Plus Code as search input) ----
//
// Ported from the same reference implementation. Three shapes matter:
//   - FULL   e.g. "87F6WQVC+7R" — decodes to lat/lon on its own.
//   - SHORT  e.g. "WQVC+7R"     — needs a reference point (a city) to recover
//                                 the full code before decoding.
//   - PADDED e.g. "87F60000+"   — valid but low precision; still decodable.
// GRID_* handle the optional 11th+ grid-refinement chars (finer than 10-digit).

const PAD = "0";
const GRID_ROWS = 5;
const GRID_COLS = 4;
const GRID_SIZE = 0.000125; // degrees spanned by the 10th digit's cell

// Is `code` a structurally valid OLC (full, short, or padded)?
export function isValidPlusCode(code) {
  if (!code) return false;
  const sep = code.indexOf(SEP);
  if (sep === -1 || sep !== code.lastIndexOf(SEP)) return false; // exactly one "+"
  if (code.length === 1) return false;
  if (sep > SEP_POS || sep % 2 === 1) return false;              // legal separator position
  // Padding: an even-length run, not leading, and the code must then end at "+".
  if (code.indexOf(PAD) > -1) {
    if (code.indexOf(PAD) === 0) return false;
    const pads = code.match(/0+/g);
    if (pads.length > 1 || pads[0].length % 2 === 1 || pads[0].length > SEP_POS - 2) return false;
    if (code.charAt(code.length - 1) !== SEP) return false;
  }
  if (code.length - sep - 1 === 1) return false;                 // exactly one trailing char is illegal
  const body = code.replace(/\+/, "").replace(/0+/, "");
  for (const ch of body) {
    if (ch !== SEP && ALPHABET.indexOf(ch.toUpperCase()) === -1) return false;
  }
  return true;
}

// A short code has its separator before position 8 (four+ leading digits dropped).
export function isShortPlusCode(code) {
  if (!isValidPlusCode(code)) return false;
  const sep = code.indexOf(SEP);
  return sep >= 0 && sep < SEP_POS;
}

// A full code is valid, not short, and decodes to a legal lat/lon.
export function isFullPlusCode(code) {
  if (!isValidPlusCode(code) || isShortPlusCode(code)) return false;
  const firstLat = ALPHABET.indexOf(code.charAt(0).toUpperCase()) * 20;
  if (firstLat >= LAT_MAX * 2) return false;      // would decode to lat >= 90
  if (code.length > 1) {
    const firstLon = ALPHABET.indexOf(code.charAt(1).toUpperCase()) * 20;
    if (firstLon >= LON_MAX * 2) return false;    // would decode to lon >= 180
  }
  return true;
}

// Decode one axis (lat if offset 0, lon if 1): every second char, base-20,
// weighted by PAIR_RES. Returns [lo, lo + resolutionOfLastPair].
function decodePairsSequence(code, offset) {
  let i = 0, value = 0;
  while (i * 2 + offset < code.length) {
    value += ALPHABET.indexOf(code.charAt(i * 2 + offset)) * PAIR_RES[i];
    i += 1;
  }
  return [value, value + PAIR_RES[i - 1]];
}

// Decode the optional grid-refinement tail (chars past the 10th).
function decodeGrid(code) {
  let latLo = 0, lonLo = 0, latPlace = GRID_SIZE, lonPlace = GRID_SIZE;
  for (const ch of code) {
    const idx = ALPHABET.indexOf(ch);
    const row = Math.floor(idx / GRID_COLS), col = idx % GRID_COLS;
    latPlace /= GRID_ROWS;
    lonPlace /= GRID_COLS;
    latLo += row * latPlace;
    lonLo += col * lonPlace;
  }
  return { latLo, lonLo, latPlace, lonPlace };
}

// Decode a FULL Plus Code to its cell center { lat, lon } (or null if not full).
export function decodePlusCode(code) {
  if (!isFullPlusCode(code)) return null;
  const clean = code.replace(SEP, "").replace(/0+/, "").toUpperCase();
  const lat = decodePairsSequence(clean.slice(0, CODE_LEN), 0);
  const lon = decodePairsSequence(clean.slice(0, CODE_LEN), 1);
  let latLo = lat[0] - LAT_MAX, lonLo = lon[0] - LON_MAX;
  let latHi = lat[1] - LAT_MAX, lonHi = lon[1] - LON_MAX;
  if (clean.length > CODE_LEN) {
    const g = decodeGrid(clean.slice(CODE_LEN));
    latHi = latLo + g.latLo + g.latPlace;
    lonHi = lonLo + g.lonLo + g.lonPlace;
    latLo += g.latLo;
    lonLo += g.lonLo;
  }
  return { lat: (latLo + latHi) / 2, lon: (lonLo + lonHi) / 2 };
}

// Recover the nearest FULL code to (refLat, refLon) that matches a SHORT code,
// then return its decoded center. A full code passed here decodes directly.
export function recoverPlusCode(shortCode, refLat, refLon) {
  if (!isShortPlusCode(shortCode)) {
    return isFullPlusCode(shortCode) ? decodePlusCode(shortCode) : null;
  }
  const rLat = clipLat(refLat);
  const rLon = normLon(refLon);
  const code = shortCode.toUpperCase();
  const padLen = SEP_POS - code.indexOf(SEP);
  const resolution = Math.pow(20, 2 - padLen / 2);
  const halfCell = resolution / 2;

  const roundedLat = Math.floor(rLat / resolution) * resolution;
  const roundedLon = Math.floor(rLon / resolution) * resolution;

  // Prefix the short code with the reference's leading digits, then decode.
  const full = encodePlusCode(roundedLat, roundedLon).substr(0, padLen) + code;
  const area = decodePlusCode(full);
  if (!area) return null;

  // Nudge one cell if the recovered center is more than half a cell from the
  // reference — the nearest match may be in the neighbouring cell.
  let { lat, lon } = area;
  const dLat = lat - rLat;
  if (dLat > halfCell) lat -= resolution;
  else if (dLat < -halfCell) lat += resolution;
  const dLon = lon - rLon;
  if (dLon > halfCell) lon -= resolution;
  else if (dLon < -halfCell) lon += resolution;

  // A nudge near the poles / antimeridian can push out of range; bring it back
  // (the reference re-encodes, which normalizes — we do it explicitly).
  return { lat: clipLat(lat), lon: normLon(lon) };
}
