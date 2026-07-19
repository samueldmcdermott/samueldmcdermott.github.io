// Turn a user's query (ZIP, US airport code, city name, or Google Plus Code)
// into a location. Everything here must be CORS-clean from a static origin
// (GitHub Pages), so we use Zippopotam (ACAO:*) for ZIPs and Open-Meteo
// geocoding for names/airports. Plus Codes decode client-side (pure math).

import { isFullPlusCode, isShortPlusCode, decodePlusCode, recoverPlusCode } from "./pluscode.js";

const looksLikeZip = (q) => /^\d{5}(-\d{4})?$/.test(q.trim());
// IATA (3) or ICAO (4) alpha codes, e.g. JFK / KJFK.
const looksLikeAirport = (q) => /^[A-Za-z]{3,4}$/.test(q.trim());
// A token containing "+" in a legal Plus Code position, e.g. "87F6WQVC+7R" or
// the short "WQVC+7R". The "+" must sit at an even index within the first 8
// chars — enough to route to the Plus Code branch (real validation follows).
const looksLikePlusCode = (q) => /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,7}$/i
  .test(q.trim().split(/\s+/)[0]);

async function fromZip(zip) {
  const z = zip.trim().slice(0, 5);
  const r = await fetch(`https://api.zippopotam.us/us/${z}`);
  if (!r.ok) throw new Error(`ZIP ${z} not found`);
  const d = await r.json();
  const p = d.places[0];
  return {
    lat: parseFloat(p.latitude),
    lon: parseFloat(p.longitude),
    label: `${p["place name"]}, ${p["state abbreviation"]} ${z}`,
  };
}

async function fromName(name) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&" +
    `name=${encodeURIComponent(name.trim())}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Geocoding service error");
  const d = await r.json();
  const hit = d.results && d.results[0];
  if (!hit) throw new Error(`Couldn't find “${name}”`);
  const parts = [hit.name, hit.admin1, hit.country_code].filter(Boolean);
  return { lat: hit.latitude, lon: hit.longitude, label: parts.join(", ") };
}

// Resolve a Google Plus Code. Two forms:
//   full   "87F6WQVC+7R"            -> decode directly (no network)
//   short  "WQVC+7R Philadelphia"   -> geocode the locality for a reference
//                                       point, then recover the full code
// A bare short code ("WQVC+7R" with no locality) can't be placed without a
// reference, so we ask for a city.
async function fromPlusCode(query) {
  const parts = query.trim().split(/\s+/);
  const code = parts[0].toUpperCase();
  const locality = parts.slice(1).join(" ").trim();

  if (isFullPlusCode(code)) {
    const { lat, lon } = decodePlusCode(code);
    const suffix = locality ? ` · ${locality}` : "";
    return { lat, lon, label: `${code}${suffix}` };
  }

  if (isShortPlusCode(code)) {
    if (!locality) {
      throw new Error(`“${code}” is a short Plus Code — add a city, e.g. “${code} Philadelphia”`);
    }
    const ref = await fromName(locality); // reference point for recovery
    const recovered = recoverPlusCode(code, ref.lat, ref.lon);
    if (!recovered) throw new Error(`Couldn't place Plus Code “${code}”`);
    return { lat: recovered.lat, lon: recovered.lon, label: `${code} ${locality}` };
  }

  throw new Error(`“${code}” isn't a valid Plus Code`);
}

// Public: resolve any query. Airport codes are tried as names too (Open-Meteo
// indexes many airport names / IATA codes); if that misses we surface the error.
export async function geocode(query) {
  const q = (query || "").trim();
  if (!q) throw new Error("Enter a ZIP, airport code, city, or Plus Code");
  if (looksLikePlusCode(q)) return fromPlusCode(q);
  if (looksLikeZip(q)) return fromZip(q);
  if (looksLikeAirport(q)) {
    try {
      return await fromName(q.toUpperCase());
    } catch {
      return fromName(q + " airport");
    }
  }
  return fromName(q);
}
