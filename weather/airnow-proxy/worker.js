// Cloudflare Worker: AirNow proxy.
//
// Holds the AirNow API key server-side (as a secret, never in client code) and
// re-serves current observations + the daily forecast with permissive CORS so
// the static site can read them. AirNow itself already sends ACAO:*, so this
// exists ONLY to keep the API key off the public page.
//
// Deploy: see ../AIRNOW_SETUP.md. Exposes:
//   GET /airnow/observation?lat=..&lon=..            -> current obs JSON (array)
//   GET /airnow/forecast?lat=..&lon=..[&date=Y-M-D]  -> daily forecast (array)

const AIRNOW = "https://www.airnowapi.org/aq";
// Lock this to your site's origin (or "*" while testing).
const ALLOW_ORIGIN = "https://samueldmcdermott.github.io";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=600", // AirNow updates ~hourly
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const lat = num(url.searchParams.get("lat"));
    const lon = num(url.searchParams.get("lon"));
    if (lat == null || lon == null) return json({ error: "lat/lon required" }, 400, cors);

    const key = env.AIRNOW_KEY;
    if (!key) return json({ error: "proxy missing AIRNOW_KEY" }, 500, cors);

    let upstream;
    if (url.pathname.endsWith("/airnow/observation")) {
      upstream = `${AIRNOW}/observation/latLong/current/?format=application/json`
        + `&latitude=${lat}&longitude=${lon}&distance=50&API_KEY=${key}`;
    } else if (url.pathname.endsWith("/airnow/forecast")) {
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      upstream = `${AIRNOW}/forecast/latLong/?format=application/json`
        + `&latitude=${lat}&longitude=${lon}&date=${date}&distance=50&API_KEY=${key}`;
    } else {
      return json({ error: "not found" }, 404, cors);
    }

    const r = await fetch(upstream, { cf: { cacheTtl: 600 } });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};

function num(s) { const n = parseFloat(s); return Number.isFinite(n) ? n : null; }
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
