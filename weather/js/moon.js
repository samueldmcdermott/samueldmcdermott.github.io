// Moon phase — computed locally, no API. Uses the standard synodic-month
// approximation from a known new moon epoch. Accurate to well under a day,
// which is all a phase label/illumination needs.

const SYNODIC = 29.530588853; // days
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14) / 1000; // 2000-01-06 18:14 UTC

const NAMES = [
  { name: "New moon", glyph: "🌑" },
  { name: "Waxing crescent", glyph: "🌒" },
  { name: "First quarter", glyph: "🌓" },
  { name: "Waxing gibbous", glyph: "🌔" },
  { name: "Full moon", glyph: "🌕" },
  { name: "Waning gibbous", glyph: "🌖" },
  { name: "Last quarter", glyph: "🌗" },
  { name: "Waning crescent", glyph: "🌘" },
];

export function moonPhase(date = new Date()) {
  const days = (date.getTime() / 1000 - NEW_MOON_EPOCH) / 86400;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC; // 0..29.53
  const frac = age / SYNODIC; // 0..1
  // 8 bins, centered so "new" spans the wrap point.
  const idx = Math.floor(frac * 8 + 0.5) % 8;
  // Illuminated fraction of the disk (0 new, 1 full).
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  return {
    ...NAMES[idx],
    ageDays: age,
    illumination: illum,
    nextFull: nextPhase(date, 0.5),
    nextNew: nextPhase(date, 0),
  };
}

// Days until the next time the phase-fraction hits `target` (0=new, .5=full).
function nextPhase(date, target) {
  const days = (date.getTime() / 1000 - NEW_MOON_EPOCH) / 86400;
  const frac = (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
  let delta = target - frac;
  if (delta <= 0) delta += 1;
  return delta * SYNODIC;
}
