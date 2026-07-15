// Turn a user's query (ZIP, US airport code, or city name) into a location.
// Everything here must be CORS-clean from a static origin (GitHub Pages), so we
// use Zippopotam (ACAO:*) for ZIPs and Open-Meteo geocoding for names/airports.

const looksLikeZip = (q) => /^\d{5}(-\d{4})?$/.test(q.trim());
// IATA (3) or ICAO (4) alpha codes, e.g. JFK / KJFK.
const looksLikeAirport = (q) => /^[A-Za-z]{3,4}$/.test(q.trim());

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

// Public: resolve any query. Airport codes are tried as names too (Open-Meteo
// indexes many airport names / IATA codes); if that misses we surface the error.
export async function geocode(query) {
  const q = (query || "").trim();
  if (!q) throw new Error("Enter a ZIP, airport code, or city");
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
